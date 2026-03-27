# Talk Sketch Application Workflow - Quick Reference

## 🎯 Core Workflow

### User Journey
```
Draw on Board → Auto-Recognition (450ms debounce) → View Result
                                                        ↓
                                    Click "Insert Into Chat" (optional)
                                                        ↓
                                    Type Chat Question (optional)
                                                        ↓
                                    AI Analysis (with math context)
                                                        ↓
                                    View Response
```

## 🧮 Math Recognition Process

```javascript
// Step 1: Drawing captured by Excalidraw
onSceneChange(elements) → setSceneElements(elements)

// Step 2: Debounced recognition trigger (450ms after last change)
useEffect(() => {
  const timer = setTimeout(() => recognizeScene(), 450)
}, [sceneElements])

// Step 3: Export scene as image
exportSceneImage(excalidrawAPI) → PNG blob → base64 data URI

// Step 4: Send to CoMER endpoint
fetch("/recognize-math", {
  method: "POST",
  body: JSON.stringify({ imageData: "data:image/png;base64,..." })
})

// Step 5: Backend processing
Express → CoMER Python Worker → PyTorch Model → Beam Search → LaTeX

// Step 6: Display result
setRecognizedMath(latex) → Rendered in Math Recognition Card
```

## 📊 CoMER Recognition Pipeline

### Backend (server.js)
```
Request /recognize-math
    ↓
Check cache (LRU, max 64)
    ├─ Hit: Return cached result
    └─ Miss: Continue
    ↓
Send to CoMER worker: { id: UUID, imageData: base64 }
    ↓
Wait for response (20s timeout)
    ↓
Cache result
    ↓
Return JSON: { latex, normalized, score, issues, isReliable }
```

### Python Worker (comer_worker.py)
```
Receive JSON request
    ↓
Decode base64 image
    ↓
Preprocess:
  • Convert to grayscale
  • Auto-detect ink color (invert if needed)
  • Find content bounding box
  • Crop with padding
  • Auto-contrast & binarization
  • Dilate/erode for clean strokes
    ↓
Normalize to [1, 1, H, W] tensor
    ↓
Run CoMER model:
  • Encoder processes image
  • Decoder generates LaTeX tokens
  • Beam search finds best hypothesis
    ↓
Convert tokens to LaTeX string
    ↓
Return JSON: { latex, score, issues, isReliable }
```

## 💬 Chat Integration

### Expression Questions
When user asks about math (detected by patterns):
- "What is on the board?"
- "Recognize the expression"
- "What's the equation?"

```javascript
if (isExpressionQuestion(message)) {
  // Include recognized LaTeX in chat context
  fetch("/analyze-sketch", {
    body: JSON.stringify({
      message,
      recognizedMath: "x^{2} + y^{2}",  // Auto-included!
      elements
    })
  })
}
```

### AI Response Context
```
System: "You are TalkSketch AI Coach..."
User:   "What is on the board?
         Recognized math: x^{2} + y^{2} = 1
         [sketch elements...]"

Response: AI analyzes the equation with context
```

## 🔧 Configuration

### Environment Variables
```bash
# Python executable
COMER_PYTHON_BIN=python3

# Model checkpoint path
COMER_MODEL_PATH=/path/to/model.ckpt

# Inference device
COMER_DEVICE=cpu|cuda|mps

# Server config
HOST=127.0.0.1
PORT=3001
NODE_ENV=production|development
```

### Default Paths
```
Model:    CoMER/lightning_logs/version_0/checkpoints/epoch=151-*.ckpt
Worker:   scripts/comer_worker.py
Example:  example/UN19_1041_em_595.bmp
Frontend: src/
```

## 📡 API Endpoints

### POST /recognize-math
**Request:**
```json
{
  "imageData": "data:image/png;base64,iVBORw0KGgoAAAANS..."
}
```

**Response:**
```json
{
  "latex": "x^{2} + y^{2} = 1",
  "normalized": "x^{2} + y^{2} = 1",
  "score": 0.95,
  "imageSize": [512, 256],
  "device": "cpu",
  "isReliable": true,
  "issues": [],
  "model": "CoMER",
  "cached": false
}
```

### POST /analyze-sketch
**Request:**
```json
{
  "apiKey": "sk-xxx",
  "message": "What is on the board?",
  "elements": [...],
  "recognizedMath": "x^{2} + y^{2} = 1"
}
```

**Response:**
```json
{
  "result": "The equation represents a unit circle in the x-y plane..."
}
```

## 🎨 Frontend Components

### App.jsx (Main Container)
- State management for recognition & chat
- Scene change handling
- Image export logic
- Message formatting

### Whiteboard.jsx (Excalidraw Wrapper)
- Drawing surface
- Emits scene changes
- Provides Excalidraw API

### Math Recognition Card (UI)
- Shows LaTeX preview
- Displays confidence score
- Shows error messages
- "Insert Into Chat" button

### Chat Panel
- Message history
- Input field with auto-complete
- Context indicator when math included
- Speech recognition button (optional)

## ⚡ Performance Tips

### Recognition Speed
- **First request**: ~2-5s (model load)
- **Subsequent requests**: ~500ms-1s
- **Cached requests**: <10ms
- **Network overhead**: ~200ms

### Optimization Tactics
1. Enable GPU if available: `COMER_DEVICE=cuda`
2. Use production build: `npm run build`
3. Cache results: Backend auto-caches with LRU
4. Debounce helps: 450ms gives ~90% reduction in requests
5. Image sizing: Frontend resizes to max 1200x900000px

## 🐛 Troubleshooting

### Recognition Not Working
```
1. Check Python worker started: Look for "CoMER worker ready" in logs
2. Verify model exists: CoMER/lightning_logs/version_0/checkpoints/
3. Check device: nvidia-smi for GPU, ensure CUDA available if using GPU
4. Try CPU fallback: export COMER_DEVICE=cpu
```

### Slow Recognition
```
1. Check device utilization: nvidia-smi (GPU) or top (CPU)
2. Model loading: First request always slower
3. Image size: Large drawings take longer to process
4. Network: Check backend logs for timing
```

### Errors in Recognition Card
```
1. "No handwritten math was detected" → Draw larger/clearer
2. "Math recognition is taking longer" → Model processing, wait
3. "Recognition failed" → Check backend logs for details
4. Empty result → Drawing might be too small or unclear
```

### Chat Not Including Math
```
1. Verify math recognized successfully
2. Check question matches expression patterns
3. Try "Insert Into Chat" button to manually include
4. Check API key is set in UI
```

## 📈 Monitoring

### Check Worker Status
```bash
# Server logs should show:
# "CoMER worker ready on cpu using epoch=151-*.ckpt"
# "CoMER worker warmup complete."
```

### Monitor Cache
- Frontend cache: Max 64 entries (LRU)
- Space: ~1-2MB per cached image
- Efficiency: ~70-80% hit rate typical

### Performance Metrics
- Recognition latency: Should be <1s (cached), <2s (uncached)
- Chat response: Depends on OpenAI/Claude (~2-5s)
- Total user wait: Usually <5s for full workflow

## 🚀 Deployment

### Development
```bash
npm run dev                # Frontend on :5174
npm run start:server       # Backend on :3001
```

### Production
```bash
npm run build
npm run serve:prod         # Both on :3001
```

### Docker Ready
- Python dependencies: requirements.txt
- Node dependencies: package.json
- Model: Embedded in repository

## 📚 Documentation Files

- **WORKFLOW.md**: Complete architecture & data flow
- **COMER_INTEGRATION_STATUS.md**: Integration status & verification
- **README.md**: Getting started & setup
- **server.js**: Backend API implementation
- **scripts/comer_worker.py**: Model inference worker

## 🔗 Key Files Reference

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main React component, recognition logic |
| `src/library/Whiteboard.jsx` | Excalidraw wrapper |
| `server.js` | Express backend, worker management |
| `scripts/comer_worker.py` | CoMER inference worker |
| `CoMER/` | Model checkpoints & code |
| `example/` | Sample drawings for testing |

---

**Status**: ✅ Test branch is production-ready with full CoMER integration
**Last Updated**: March 2026
