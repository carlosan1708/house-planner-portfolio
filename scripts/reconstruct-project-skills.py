#!/usr/bin/env python3
"""Build a local, explicitly retrospective skills-first presentation branch.

Never updates a source ref, working index, remote, or deployed source. Original
commit metadata remains original evidence; the new foundation uses today's date.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

SKILLS = ('house-planner-release', 'house-planner-qa',
          'house-planner-access-review', 'house-planner-mobile-ux')
GUIDES = ('.agents/project-skills-provenance.md', 'docs/development/project-skills.md')
SIGNATURES = {b'gpgsig', b'gpgsig-sha256', b'mergetag'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='codex/portfolio-sdd')
    parser.add_argument('--target', default='codex/presentation-skills')
    parser.add_argument('--output', default='.qa-tools/project-skills-history')
    parser.add_argument('--preserve-checkout', action='append', default=[])
    args = parser.parse_args()
    started = int(time.time())

    def git(*arguments, data=None, env=None, cwd=None, check=True):
        result = subprocess.run(['git', *arguments], input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=env, cwd=cwd, check=False)
        if check and result.returncode:
            raise RuntimeError('git ' + ' '.join(arguments[:3]) + ': ' + result.stderr.decode('utf-8', 'replace'))
        return result

    def value(*arguments):
        return git(*arguments).stdout.decode().strip()

    root = Path(value('rev-parse', '--show-toplevel')).resolve()
    os.chdir(root)
    if not args.target.startswith('codex/presentation-'):
        raise ValueError('Target must be a new codex/presentation-* branch')
    target = 'refs/heads/' + args.target
    git('check-ref-format', target)
    if git('show-ref', '--verify', '--quiet', target, check=False).returncode == 0:
        raise ValueError('Target already exists; no existing branch will be overwritten')
    source = value('rev-parse', '--verify', args.source + '^{commit}')
    refs_before = value('for-each-ref', '--format=%(refname) %(objectname)').splitlines()
    output = (root / args.output).resolve()
    if not output.is_relative_to(root):
        raise ValueError('Recovery output must remain inside the checkout')
    if git('check-ignore', '--quiet', '--no-index', str(output.relative_to(root)), check=False).returncode:
        raise ValueError('Recovery output must be Git-ignored')
    output.mkdir(parents=True, exist_ok=True)
    bundle = output / 'original-history.bundle'
    if bundle.exists():
        raise ValueError('Recovery bundle already exists; choose a fresh output folder')

    def fingerprint(checkout):
        status = git('status', '--porcelain=v1', '-z', '--untracked-files=all', cwd=checkout).stdout
        diff = git('diff', '--binary', 'HEAD', cwd=checkout).stdout
        digest = hashlib.sha256(status + b'\0' + diff)
        # Porcelain -z rename records have an extra old-path entry. Only untracked
        # entries require a file digest; tracked bytes are already in git diff.
        for item in status.split(b'\0'):
            if item.startswith(b'?? '):
                path = Path(checkout) / os.fsdecode(item[3:])
                digest.update(item)
                if path.is_symlink():
                    digest.update(os.fsencode(os.readlink(path)))
                elif path.is_file():
                    with path.open('rb') as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            digest.update(block)
        return digest.hexdigest()

    checkouts = [root, *(Path(p).resolve() for p in args.preserve_checkout)]
    work_before = {str(path): fingerprint(path) for path in checkouts}
    git('bundle', 'create', str(bundle), '--all')
    git('bundle', 'verify', str(bundle))
    print('Recovery bundle verified.', flush=True)

    payload = {}
    for name in SKILLS:
        for suffix in ('SKILL.md', 'agents/openai.yaml'):
            path = f'.agents/skills/{name}/{suffix}'
            payload[path] = value('hash-object', '-w', '--', path)
    for path in GUIDES:
        payload[path] = value('hash-object', '-w', '--', path)
    agent_text = (root / 'AGENTS.md').read_text(encoding='utf-8')
    approval_start = agent_text.index('## Autorización antes de regresiones completas')
    approval_end = agent_text.find('\n## ', approval_start + 3)
    approval = agent_text[approval_start:approval_end if approval_end >= 0 else None].strip()
    catalog = ('## Reconstructed project skill foundation\n\n'
               'This local presentation history places skills first retrospectively. '
               'Read [foundation provenance](.agents/project-skills-provenance.md) and '
               '[skill selection](docs/development/project-skills.md). '
               'These skills were authored on 2026-10-14, not at the original launch. '
               'Use operational main for deployment; historical evidence keeps its original SHA.\n')
    index_env = dict(os.environ, GIT_INDEX_FILE=str(output / 'temporary-index'))
    cache = {}
    allowed = set(payload) | {'AGENTS.md'}

    def overlay(tree):
        if tree in cache:
            return cache[tree]
        prior = git('show', f'{tree}:AGENTS.md', check=False)
        text = prior.stdout.decode('utf-8') if prior.returncode == 0 else ''
        if approval.splitlines()[0] not in text:
            text = text.rstrip() + '\n\n' + approval + '\n'
        if catalog.splitlines()[0] not in text:
            text = text.rstrip() + '\n\n' + catalog
        agent_blob = git('hash-object', '-w', '--stdin', data=text.lstrip().encode('utf-8')).stdout.decode().strip()
        expected = dict(payload, **{'AGENTS.md': agent_blob})
        git('read-tree', tree, env=index_env)
        changes = b''.join(f'100644 {blob}\t{path}\0'.encode() for path, blob in expected.items())
        git('update-index', '-z', '--index-info', data=changes, env=index_env)
        new_tree = git('write-tree', env=index_env).stdout.decode().strip()
        modified = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', tree, new_tree).stdout
        unexpected = set(os.fsdecode(p) for p in modified.split(b'\0') if p) - allowed
        if unexpected:
            raise RuntimeError('Undeclared tree changes: ' + repr(unexpected))
        entries = git('ls-tree', '-r', '-z', new_tree, '--', *expected).stdout.split(b'\0')
        found = {}
        for entry in filter(None, entries):
            metadata, path = entry.split(b'\t', 1)
            mode, kind, blob = metadata.split()
            if mode != b'100644' or kind != b'blob':
                raise RuntimeError('Unexpected overlay entry mode/type')
            found[os.fsdecode(path)] = blob.decode()
        if found != expected:
            raise RuntimeError('Overlay content verification failed')
        cache[tree] = new_tree
        return new_tree

    def headers(commit):
        raw = git('cat-file', 'commit', commit).stdout
        header, separator, message = raw.partition(b'\n\n')
        if not separator:
            raise RuntimeError('Invalid commit data')
        fields = []
        for line in header.split(b'\n'):
            if line.startswith(b' '):
                fields[-1] += b'\n' + line
            else:
                fields.append(line)
        return fields, message

    empty_tree = git('mktree', data=b'').stdout.decode().strip()
    foundation_tree = overlay(empty_tree)
    fresh_env = dict(os.environ)
    for key in ('GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE'):
        fresh_env.pop(key, None)
    foundation = git('commit-tree', foundation_tree, data=(
        'chore(skills): reconstruct project skill foundation\n\n'
        'Authored now and placed first for an explicitly retrospective presentation.\n'
        'Original development did not begin with these skills.\n').encode(), env=fresh_env).stdout.decode().strip()
    mapping = {}
    originals = value('rev-list', '--reverse', '--topo-order', source).splitlines()
    stripped = 0
    merges = 0
    for ordinal, old in enumerate(originals, 1):
        fields, message = headers(old)
        old_tree = next(f.split(b' ', 1)[1].decode() for f in fields if f.startswith(b'tree '))
        parents = [f.split(b' ', 1)[1].decode() for f in fields if f.startswith(b'parent ')]
        new_parents = [mapping[p] for p in parents] or [foundation]
        new_fields = [b'tree ' + overlay(old_tree).encode()]
        new_fields += [b'parent ' + p.encode() for p in new_parents]
        for field in fields:
            key = field.split(b' ', 1)[0]
            if key in SIGNATURES:
                stripped += 1
            elif key not in (b'tree', b'parent'):
                new_fields.append(field)
        new = git('hash-object', '-t', 'commit', '-w', '--stdin', data=b'\n'.join(new_fields) + b'\n\n' + message).stdout.decode().strip()
        verified_fields, verified_message = headers(new)
        old_metadata = [f for f in fields if f.split(b' ', 1)[0] not in SIGNATURES | {b'tree', b'parent'}]
        new_metadata = [f for f in verified_fields if f.split(b' ', 1)[0] not in {b'tree', b'parent'}]
        if old_metadata != new_metadata or message != verified_message:
            raise RuntimeError('Historical metadata/message changed')
        if [f for f in verified_fields if f.startswith(b'parent ')] != [b'parent ' + p.encode() for p in new_parents]:
            raise RuntimeError('Mapped parent topology mismatch')
        mapping[old] = new
        merges += len(parents) > 1
        if ordinal % 50 == 0:
            print(f'Verified {ordinal}/{len(originals)} archived commits.', flush=True)
    tip = mapping[source]
    git('fsck', '--connectivity-only', '--no-reflogs', '--no-dangling', tip)
    if value('for-each-ref', '--format=%(refname) %(objectname)').splitlines() != refs_before:
        raise RuntimeError('A source ref changed during reconstruction; no branch created')
    if {str(path): fingerprint(path) for path in checkouts} != work_before:
        raise RuntimeError('A protected checkout changed during reconstruction; no branch created')
    foundation_fields, _ = headers(foundation)
    created = int(next(f for f in foundation_fields if f.startswith(b'committer ')).rsplit(b' ', 2)[1])
    if not started - 60 <= created <= int(time.time()) + 60:
        raise RuntimeError('Foundation date does not reflect this execution')
    git('update-ref', target, tip, '0' * 40)
    refs_after = value('for-each-ref', '--format=%(refname) %(objectname)').splitlines()
    if sorted(refs_after) != sorted(refs_before + [target + ' ' + tip]):
        raise RuntimeError('Unexpected ref update')
    report = {'sourceRef': args.source, 'source': source, 'targetRef': target,
              'target': tip, 'foundation': foundation, 'foundationTimestamp': created,
              'originalCommits': len(originals), 'rewrittenCommits': len(mapping),
              'mergeTopologyPreserved': merges, 'strippedSignatureHeaders': stripped,
              'everyTreeVerified': True, 'identityDateMessageVerification': 'passed',
              'originalRefsUnchanged': True, 'protectedCheckoutsUnchanged': work_before,
              'declaredOverlayPaths': sorted(allowed), 'recoveryBundle': str(bundle),
              'remoteActions': [], 'applicationRegression': 'not run',
              'limitation': 'Retrospective archived presentation; no new sanitation, application or release evidence.'}
    (output / 'sha-map.json').write_text(json.dumps(mapping, indent=2) + '\n', encoding='utf-8')
    (output / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
