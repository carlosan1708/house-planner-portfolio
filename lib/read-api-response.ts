export async function readApiResponse(response: Response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new Error(`El servidor no devolvió una respuesta válida (${response.status}). Tus cambios siguen en la pantalla. Intenta guardar de nuevo.`);
  }
}
