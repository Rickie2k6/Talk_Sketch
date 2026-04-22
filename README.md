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
- If you want a different port, start it with `PORT=<port> npm run dev:backend`.

Terminal 2, frontend:

```bash
npm run dev:frontend
```

- The frontend uses Vite's normal dev port behavior.
- The frontend binds to `0.0.0.0` by default, so Vite prints a network URL you can open from other devices on the same network.
- By default it starts on `5173`.
- If that port is busy, Vite chooses another open dev port automatically.
- In development, the Vite proxy targets `http://127.0.0.1:8080` by default.

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
