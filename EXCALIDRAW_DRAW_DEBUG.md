# Excalidraw Draw Debug Flow

This project includes a focused trace for the "stroke turns into a dot" bug.

## Enable Client Trace

In the browser console:

```js
localStorage.setItem("talkSketchDebug", "1");
location.reload();
```

Disable it with:

```js
localStorage.removeItem("talkSketchDebug");
location.reload();
```

## Enable Server Trace

Run the backend with:

```bash
COLLAB_DEBUG_FLOW=1 npm run dev:backend
```

## Browser Helpers

After the app loads, these helpers are available in the browser console:

```js
window.__talkSketchDebug.snapshot()
window.__talkSketchDebug.events()
window.__talkSketchDebug.last(40)
window.__talkSketchDebug.clear()
```

## Important Client Events

Expected order for one successful line draw:

1. `whiteboard.pointer-down`
2. `app.board.pointer-down`
3. many `whiteboard.onChange`
4. many `app.handleSceneChange.defer-while-pointer-down`
5. `whiteboard.pointer-up`
6. `app.board.pointer-up`
7. `app.emitSceneUpdate`
8. `socket.scene-update`
9. `app.applyRemoteScene.start`
10. `app.applyRemoteScene.updateScene`

If the line collapses into a dot, compare the `drawFocus.latestLinearElement` object at each step.

## What To Compare

For the active line/freehand element, watch:

- `id`
- `type`
- `version`
- `points`
- `firstPoint`
- `lastPoint`

If `points` drops from a larger value back to `2`, the scene got overwritten by an older version.

## Server Events

Important backend trace entries:

- `socket.join-room`
- `socket.scene-update.accepted`
- `socket.scene-update.skip-stale`

These now include:

- `incomingScene.drawFocus`
- `canonicalScene.drawFocus`

That lets you check whether the server accepted the full stroke or replaced it with an older scene.
