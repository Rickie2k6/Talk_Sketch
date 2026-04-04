# Talk Sketch

Talk Sketch is a whiteboard-style math assistant with a React + Vite frontend and a Node + Express backend. In development, the frontend and backend run separately. In production, Express serves the built frontend and the API from one deployment.

## Structure

```text
frontend/             Vite + React app
backend/              Express API, Python workers, CoMER assets
README.md             repo-level setup and run guide
```

## Install

Install JavaScript dependencies:

```bash
npm install --prefix frontend
npm install --prefix backend
```

Install Python dependencies for the backend worker:

```bash
pip install -r backend/requirements.txt
```

## Development

Run the backend and frontend in separate terminals from the repo root.

Terminal 1, backend:

```bash
npm run dev:backend
```

- The backend binds to `0.0.0.0`.
- It uses port `8080` by default.
- If `8080` is busy and you did not set `PORT`, the startup script automatically chooses the next free port in `8080-8900` and writes it to `backend/.backend-port`.

Terminal 2, frontend:

```bash
npm run dev:frontend
```

- The frontend uses Vite's normal dev port behavior.
- By default it starts on `5173`.
- If that port is busy, Vite chooses another open dev port automatically.
- The Vite proxy reads `backend/.backend-port`, so start the backend first.

Open the frontend URL shown by Vite in the terminal.

## Production

Build the frontend:

```bash
npm run build:frontend
```

Start the production server:

```bash
npm run start:backend
```

Or with an explicit allowed server port:

```bash
HOST=0.0.0.0 PORT=8080 npm run start:backend
```

Then open:

```text
http://<server-hostname>:8080
```

Express serves the built frontend from `frontend/dist` and keeps the existing API routes on the same server.

## Environment Variables

Frontend variables are documented in [frontend/.env.example](/Users/cuonghn/Desktop/Talk_Sketch/Talk_Sketch/frontend/.env.example).

Backend variables are documented in [backend/.env.example](/Users/cuonghn/Desktop/Talk_Sketch/Talk_Sketch/backend/.env.example).

Important backend variables:

- `HOST`: defaults to `0.0.0.0`
- `PORT`: must be between `8080` and `8900`, defaults to `8080`
- `COMER_PYTHON_BIN`: Python interpreter for the recognition worker
- `COMER_MODEL_PATH`: optional custom CoMER checkpoint path
- `COMER_DEVICE`: inference device such as `cpu`, `cuda`, or `mps`

## Notes

- The frontend keeps using relative API paths such as `/recognize-math` and `/analyze-sketch`; the Vite proxy handles development routing.
- The backend still warms up the CoMER worker on startup.
- Chat responses still require an OpenAI API key in the app UI.
