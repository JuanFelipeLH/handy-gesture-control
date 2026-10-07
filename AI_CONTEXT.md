# Contexto para asistentes de IA

Lee este archivo antes de cambiar el código. La guía para las personas que instalan y usan el programa está en `README.md`.

## Objetivo del proyecto

Controlar el arrastre continuo de ventanas completas entre monitores de GNOME mediante una pinza de pulgar e índice detectada por webcam. El comportamiento de referencia es local, explícito, predecible y reversible.

## Configuración de referencia del usuario

- GNOME Shell 50 sobre Wayland.
- Dos monitores extendidos; el monitor de origen se elige por la zona horizontal de cámara y por el orden de pantallas de izquierda a derecha.
- Cámara por defecto `/dev/video0`; puede cambiarse en `~/.config/handy-gesture-control/config.json`.
- Resolución solicitada: 640 × 480. Tope de inferencia: 24 FPS.
- Solo una mano. Abrir la mano por 0,35 s prepara el gesto; cerrar la pinza durante 0,45 s inicia el agarre; abrirla por encima del umbral de liberación suelta.
- El movimiento es relativo y suavizado; la pinza mantiene la ventana agarrada y la liberación conserva la última posición mostrada.
- El detector usa MediaPipe Hand Landmarker en CPU. Las imágenes y coordenadas viven en memoria del proceso y no se guardan ni envían por red.

## Componentes y límites

- `extension.js`: crea el indicador de panel y solo inicia la cámara después de que el usuario active el menú.
- `hands.js`: coordina el proceso local, elige la ventana normal frontal del monitor señalado, mueve el marco mediante Mutter y cancela ante pérdida de mano, cambio de espacio o estados no seguros.
- `hand_worker.py`: captura mediante OpenCV/V4L2, calcula landmarks con MediaPipe y emite eventos JSON breves por stdout. Nunca debe emitir imágenes.
- `setup.py`: instala paquetes en un venv de usuario y descarga/verifica el modelo; no necesita `sudo`.

Este programa mueve ventanas; no mueve pestañas individuales. No añadas movimiento de cursor, clics, escritura, comandos de shell arbitrarios, elevación de privilegios, guardado de vídeo, transmisión de cámara ni activación automática de la cámara.

## Reglas para cambios

1. Mantén la cámara apagada por defecto y solicita su activación explícita desde el menú.
2. No persistas fotogramas, landmarks ni identificadores biométricos. No introduzcas acceso a Internet durante la ejecución.
3. Conserva la selección de la ventana por monitor, el arrastre X/Y continuo, el suavizado y la liberación sin salto final.
4. Si se pierde la mano, la ventana, el espacio activo o la capacidad de moverla, cancela el gesto dejando la ventana donde está.
5. Conserva rutas portables usando XDG; no introduzcas nombres de usuario, rutas de otro equipo ni secretos en el código o documentación.
6. Los parámetros editables viven en `config.json`; agrega sus valores por defecto a `extension.js` y `setup.py` y documenta el intervalo seguro en `README.md`.
7. Antes de publicar, no incluyas venvs, modelos descargados, capturas, vídeos, cachés, archivos `__pycache__`, logs ni configuraciones de máquina con información privada.
8. Respeta y atribuye las licencias de GNOME/Mutter, MediaPipe, el modelo y OpenCV. No afirmes que este proyecto es oficial de esos proveedores.

## Protocolo de eventos

`hand_worker.py` emite objetos JSON por línea con `event` y `at`. Los eventos de gesto incluyen token efímero y coordenadas normalizadas. El consumidor debe descartar tokens incorrectos, datos antiguos o coordenadas fuera de `[0, 1]`; el token se invalida al soltar o cancelar.

## Ajuste inicial

Valores de referencia: `fps=24`, `pinchEnter=0.45`, `pinchRelease=0.72`, `openThreshold=0.85`, `armSeconds=0.45`, `openSeconds=0.35`. Antes de cambiar el algoritmo, intenta calibrar mediante `config.json`; no reduzcas todos los umbrales a la vez.
