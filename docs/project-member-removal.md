# Eliminar un usuario del proyecto

En **Acceso → Usuarios**, busca a la persona y abre **Gestionar acceso**. Cada usuario que no sea administrador tiene la acción **Eliminar usuario**. La confirmación identifica a la persona y explica que perderá acceso al proyecto, desaparecerá del listado y conservará sus aportes bajo **Usuario desactivado**.

La eliminación afecta únicamente al proyecto actual. Conserva documentos, notas, presupuestos, aprobaciones y el historial; tampoco elimina la cuenta de inicio de sesión ni los permisos de otros proyectos. No se permite eliminarse a uno mismo, a un administrador ni al propietario.

`DELETE /api/access` recibe `{ "uid": "..." }` y exige una membresía administrativa vigente. Una transacción vuelve a comprobar el administrador y el usuario, registra la eliminación, desactiva la membresía y revoca las invitaciones anteriores del usuario en ese proyecto. La membresía se conserva como registro de baja con `removed: true`; no aparece en el listado, impide reparar automáticamente el acceso y bloquea los enlaces de lectura incluso con una sesión abierta.

La autoría se sustituye al leer los registros, sin reescribir los eventos firmados ni el contenido cifrado. Las fechas y los cambios originales se conservan. Una invitación nueva y explícita del administrador puede readmitir al usuario; conserva la fecha de baja para que los aportes anteriores sigan figurando como **Usuario desactivado**, mientras los nuevos muestran su identidad actual.

**Revocar acceso** retira el acceso y conserva al usuario en el filtro **Sin acceso**. También invalida sus invitaciones pendientes anteriores, para que un enlace antiguo no lo readmita. **Restaurar acceso** exige elegir el rol; una invitación nueva y explícita del administrador también puede conceder acceso de nuevo.

La pantalla separa **Usuarios**, **Invitaciones** y **Enlaces de lectura**. El directorio muestra el rol, el estado efectivo y un resumen de secciones y carpetas. Los permisos se guardan al cambiarlos dentro de **Gestionar acceso**. Los usuarios revocados o rechazados deben restaurarse antes de editar sus permisos. Las solicitudes pendientes reales se distinguen de quienes ya perdieron el acceso; una invitación pendiente a una persona con acceso concedido se muestra en el historial del enlace, sin duplicar la solicitud.

Los enlaces de lectura mantienen su propia política y vencimiento. El directorio identifica a las cuentas cuyo acceso depende de ellos; editar directamente el rol o los permisos de esas cuentas concede acceso directo con la política efectiva. Revocar un enlace actualiza el directorio y retira el acceso de las cuentas que dependían de él.
