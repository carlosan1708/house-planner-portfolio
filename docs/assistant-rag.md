# Índice privado del asistente

Las cargas compatibles en Documentos, Cotizaciones y Gastos crean un trabajo por archivo. Cloud Scheduler llama a Cloud Run cada minuto y el procesador guarda los avances por página. El chat recupera hasta ocho fragmentos y revalida la fuente antes de usarla. Las fotos de compras, las capturas móviles y las bóvedas quedan fuera del índice.

La demo y el entorno local con emuladores arrancan con el índice desactivado.
Los siguientes pasos requieren una instalación propia con ADC y acceso a servicios de Google Cloud.

## Activación

1. Verificar en las reglas activas de Firestore que ningún cliente Firebase pueda leer ni escribir en `housePlannerAssistantRag/{projectId}/{descendant=**}`, incluso cuando esté autenticado. Revisar las reglas amplias existentes porque las reglas de Firestore conceden acceso si cualquiera de las coincidencias lo permite. El servidor usa el SDK Admin con su identidad de Cloud Run.
2. Preparar la infraestructura con `scripts/configure-rag-gcp.ps1 -ProjectId <proyecto-gcp> -PublicUrl <url-cloud-run> -Service <servicio-cloud-run>`. Indicar la cuenta de Scheduler con `-SchedulerAccount` si usa un nombre distinto de `house-planner-scheduler`. Configurar `HOUSE_PLANNER_SCHEDULER_SERVICE_ACCOUNT` con el correo de esa cuenta y `HOUSE_PLANNER_PUBLIC_URL` con la misma URL de Cloud Run. El script prepara tres índices. Esperar el estado `READY` de los índices. La identidad de Cloud Run debe tener acceso a Firestore, lectura de los adjuntos en Storage y acceso a Vertex AI y Cloud Vision mediante ADC.
3. En la revisión que se va a activar, habilitar la IA con `HOUSE_PLANNER_AI_ENABLED=1` y configurar `HOUSE_PLANNER_RAG_PROJECT_IDS` con los IDs de House Planner separados por comas. El listado vacío deja deshabilitado el RAG y conserva la búsqueda de texto anterior. Habilitar primero un proyecto controlado y verificar una carga nueva, su estado y la apertura de una cita.
4. Con sesión de administrador en el proyecto activo, enviar `POST /api/assistant/documents/backfill` con `{"projectId":"ID","mode":"inventory"}`. Consultar `GET /api/assistant/documents/backfill` hasta que el inventario indique `complete`. El inventario lee metadatos. Revisar el total de adjuntos elegibles antes de iniciar el procesamiento histórico.
5. Enviar el mismo POST con `"mode":"enqueue"`. El cursor guarda el progreso entre ejecuciones, omite los trabajos ya registrados y da prioridad a cargas nuevas. Cuando termina el recorrido, los trabajos en cola se siguen procesando. El GET muestra los conteos por estado para confirmar que la cola se agotó.

## Diagnóstico

El procesador registra conteos y omite texto, nombres de archivos, consultas y claves de Storage en los logs. Los archivos con errores se pueden reintentar desde su sección. La ruta de estado de adjuntos es de solo lectura. Si falla una búsqueda, el chat comunica que la evidencia documental no está disponible. Para suspender el RAG en un proyecto, retirarlo de la lista de activación. Los trabajos quedan guardados para reanudarlos.
