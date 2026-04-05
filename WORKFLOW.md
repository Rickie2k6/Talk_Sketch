# Talk Sketch - Application Workflow with CoMER

## Overview

Talk Sketch is an interactive whiteboard application that combines handwritten math recognition with AI-powered chat assistance. The application uses the **CoMER (Combining Outputs for Math Expression Recognition)** model to recognize handwritten mathematical expressions drawn on the whiteboard.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                      │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────────┐   │
│  │ Whiteboard   │  │ Math        │  │ Chat Assistant       │   │
│  │ (Excalidraw) │  │ Recognition │  │ (OpenAI/Claude)      │   │
│  └──────┬───────┘  │ Card        │  │                      │   │
│         │          └──────┬──────┘  └──────────┬───────────┘   │
│         │                 │                     │               │
│         └─────────┬───────┴─────────────────────┘               │
│                   │ HTTP Requests                               │
└───────────────────┼─────────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────────────────────────────────────────────┐
│         Express Backend (Node.js)                │
│  ┌─────────────────────────────────────────┐    │
│  │ /recognize-math (Math Recognition API)  │    │
│  │  - Receives image data from frontend    │    │
│  │  - Sends to CoMER Python worker         │    │
│  │  - Returns LaTeX and metadata           │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ /analyze-sketch (Chat API)              │    │
│  │  - Receives chat message + sketch data  │    │
│  │  - Can include recognized math          │    │
│  │  - Sends to OpenAI/Claude for analysis  │    │
│  └─────────────────────────────────────────┘    │
└──────────────────┬───────────────────────────────┘
                   │ JSON messages via stdin/stdout
                   ▼
┌──────────────────────────────────────────────────┐
│    CoMER Python Worker (Multi-threaded)         │
│  ┌─────────────────────────────────────────┐    │
│  │ 1. Load CoMER Model from Checkpoint     │    │
│  │    (PyTorch Lightning model)            │    │
│  │                                         │    │
│  │ 2. Process Image:                       │    │
│  │    - Extract base64 data               │    │
│  │    - Preprocess (crop, normalize)      │    │
│  │    - Resize to model constraints       │    │
│  │                                         │    │
│  │ 3. Run Inference:                       │    │
│  │    - Convert image to tensor           │    │
│  │    - Run through CoMER encoder/decoder │    │
│  │    - Use beam search for predictions   │    │
│  │                                         │    │
│  │ 4. Generate Output:                     │    │
│  │    - Convert indices to LaTeX tokens   │    │
│  │    - Return confidence scores          │    │
│  │    - Cache results for efficiency      │    │
│  └─────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

## Data Flow

### 1. User Draws on Whiteboard
- User draws mathematical expressions on the Excalidraw whiteboard
- Each stroke is recorded in Excalidraw's internal format
- Scene changes trigger the recognition system

### 2. Automatic Math Recognition (Debounced)
```
Drawing → Scene Change Event
    ↓
[450ms debounce delay for user to finish drawing]
    ↓
Export scene as PNG image (with padding and resizing)
    ↓
Convert image to base64 data URI
    ↓
POST /recognize-math with image data
    ↓
Express backend receives request
    ↓
Check recognition cache (LRU, max 64 items)
    ↓
If not cached:
  └─→ Send JSON message to CoMER worker stdin:
      { id: "uuid", imageData: "data:image/png;base64,..." }
    ↓
CoMER worker receives request
    ↓
[Worker Processing]:
  1. Decode base64 image
  2. Preprocess:
     - Convert to grayscale
     - Auto-invert if needed (detect ink color)
     - Find content bounding box
     - Crop with padding
     - Apply auto-contrast and binarization
     - Dilate/erode for cleaner strokes
  3. Resize to fit model constraints:
     - Min: 16x16, Max: 1024x256
  4. Run CoMER inference:
     - Feed normalized image tensor to model
     - Create attention masks
     - Beam search over decoder outputs
  5. Convert output tokens to LaTeX
    ↓
CoMER worker returns JSON via stdout
    ↓
Express caches and returns to frontend:
{
  latex: "x^{2} + y^{2} = 1",
  normalized: "x^{2} + y^{2} = 1",
  score: 0.95,
  imageSize: [512, 256],
  device: "cpu",
  isReliable: true,
  issues: [],
  cached: false,
  model: "CoMER"
}
    ↓
Frontend displays recognized LaTeX in math recognition card
    ↓
User can copy, insert into chat, or verify results
```

### 3. Manual Recognition (Button)
- User clicks "Recognize Math Now" button
- Bypasses debounce timer
- Immediate recognition request sent to CoMER

### 4. Chat with Context (Optional)
```
User types question → "What is x² + y²?"
    ↓
App detects if question is about expression (matches patterns):
  "math expression", "equation", "what is on the board", etc.
    ↓
If expression question and math recognized:
  └─→ Include recognized LaTeX in context
    ↓
Otherwise, user can click "Insert Into Chat" button
    ↓
Recognized math is inserted into chat input field
    ↓
User sends message to /analyze-sketch:
  {
    apiKey: "sk-xxx (OpenAI/Claude key)",
    elements: [excalidraw elements],
    message: "What is x² + y²?",
    recognizedMath: "x^{2} + y^{2} = 1"
  }
    ↓
Express server makes request to OpenAI/Claude:
  System: "You are TalkSketch AI Coach helping brainstorm..."
  User: "User message: What is x² + y²?
         Recognized math from CoMER: x^{2} + y^{2} = 1
         Sketch JSON: [...]"
    ↓
OpenAI/Claude returns analysis
    ↓
Frontend displays response in chat
```

### 5. Speech Input (Optional)
- User clicks microphone button
- Browser's Web Speech API captures audio
- Transcribed text appears in chat input
- User can send as question (with or without expression context)

## Key Components

### Frontend (React)

**[src/App.jsx](src/App.jsx)**
- Main React component
- Manages state for:
  - `sceneElements`: Current whiteboard drawing
  - `recognizedMath`: Latest LaTeX recognition result
  - `apiKey`: OpenAI/Claude API key
  - `chatMessages`: Chat history
  - `isRecognizingMath`: Loading state during recognition
  - `recognitionError`: Any error messages from CoMER

**Key Functions:**
- `handleSceneChange()`: Updates scene on drawing changes
- `recognizeScene()`: Sends image to CoMER and updates UI
- `exportSceneImage()`: Converts Excalidraw to PNG
- `sendMessage()`: Sends chat message to backend
- `toggleRecording()`: Toggles speech recognition

**[src/library/Whiteboard.jsx](src/library/Whiteboard.jsx)**
- React component wrapping Excalidraw
- Provides scene elements to parent App
- Configured for:
  - Freedraw tool by default
  - Black ink color
  - White background

### Backend (Express)

**[server.js](server.js)**

**Environment Variables:**
- `COMER_PYTHON_BIN`: Python executable (default: python3)
- `COMER_DEVICE`: Device for inference (default: "cpu")
- `COMER_MODEL_PATH`: Path to model checkpoint
- `NODE_ENV`: "production" or "development"
- `HOST`: Server bind address
- `PORT`: Server port

**Endpoints:**

1. **POST /recognize-math**
   - Accepts: `{ imageData: "data:image/png;base64,..." }`
   - Returns:
     ```json
     {
       "latex": "x^{2} + y^{2}",
       "normalized": "x^{2} + y^{2}",
       "score": 0.95,
       "imageSize": [512, 256],
       "device": "cpu",
       "isReliable": true,
       "issues": [],
       "model": "CoMER",
       "cached": false
     }
     ```
   - Caching: LRU cache with max 64 entries (key = SHA1 of image data)
   - Timeout: 20 seconds (frontend-side)

2. **POST /analyze-sketch**
   - Accepts:
     ```json
     {
       "apiKey": "sk-xxx",
       "message": "user question",
       "elements": [sketch elements],
       "recognizedMath": "optional LaTeX"
     }
     ```
   - Forwards to OpenAI/Claude with context
   - Returns: `{ "result": "assistant response" }`

### Python Worker (comer_worker.py)

**Process:**
1. Starts as subprocess spawned by Express
2. Loads PyTorch Lightning CoMER model from checkpoint
3. Enters stdin/stdout JSON message loop
4. For each request:
   - Decodes base64 image data
   - Preprocesses image (detects ink, crops, normalizes)
   - Runs through CoMER encoder-decoder
   - Uses beam search for best hypothesis
   - Returns LaTeX and metadata

**Preprocessing Steps:**
1. **Decode & Format**
   - Extract base64 payload from data URI
   - Open as PIL Image
   - Convert to grayscale with white background

2. **Ink Detection**
   - Calculate dark pixel ratio
   - Auto-invert if drawing is light on dark

3. **Content Extraction**
   - Find connected components (strokes)
   - Identify bounding box of content
   - Crop with padding (16px)

4. **Normalization**
   - Apply auto-contrast enhancement
   - Binarize using Otsu thresholding
   - Dilate/erode to clean up noise

5. **Size Constraints**
   - Enforce min: 16x16, max: 1024x256
   - Scale as needed

**Model Inference:**
- Image tensor: [1, 1, H, W] (batch, channel, height, width)
- Attention mask: all ones
- Beam search: finds top-k most likely LaTeX sequences
- Output: indices → vocabulary → LaTeX string

## State Management

### Recognition State
```javascript
{
  isRecognizingMath: boolean,      // true while requesting
  recognizedMath: string,          // LaTeX output from CoMER
  recognitionError: string,        // Error message if failed
  sceneElements: array,            // Current whiteboard content
  lastSceneSignatureRef: string,   // Hash to detect changes
  recognitionCacheRef: Map,        // LRU cache of results
}
```

### Chat State
```javascript
{
  apiKey: string,                  // API key (session only)
  chatInput: string,               // Current user input
  messages: array,                 // Chat history
  isSending: boolean,              // true while awaiting response
}
```

## Performance Optimizations

### Image Compression
- Maximum dimension: 1200px
- Maximum pixels: 900,000
- Smart scaling preserves aspect ratio
- Reduces model inference time

### Caching
- Backend: LRU cache (max 64 entries)
- Cache key: SHA1 hash of image data
- Frontend: React component caching via scene signature
- Avoids re-recognition of unchanged drawings

### Debouncing
- 450ms debounce on scene changes
- Waits for user to finish drawing before recognition
- Avoids excessive model inference

### Hardware Support
- CPU: Fallback default
- CUDA: Available if torch[cuda] installed
- MPS: Apple Metal Performance Shaders (if supported)
- Configurable via `COMER_DEVICE` environment variable

## Error Handling

### Recognition Errors
- **No content**: "No handwritten math was detected"
- **Timeout**: "Math recognition is taking longer than expected"
- **Model error**: "Math recognition failed"
- **Network error**: "Math recognition failed"

### Chat Errors
- **Invalid API key**: Server returns 400
- **API error**: Shows error message to user
- **Network timeout**: Shows generic error

### Worker Errors
- Worker startup failures: Logged to console
- Worker crashes: Express logs and attempts restart on next request
- Stderr output: Captured and included in error messages

## Configuration

### Default Model
- Path: `CoMER/lightning_logs/version_0/checkpoints/epoch=151-step=57151-val_ExpRate=0.6365.ckpt`
- Device: CPU (recommended for compatibility)
- Input size: up to 1024×256 pixels

### Model Customization
Set environment variables before running:
```bash
export COMER_DEVICE="cuda"
export COMER_MODEL_PATH="/path/to/custom/model.ckpt"
```

## Development Workflow

### Starting the App
```bash
# Terminal 1: Backend
npm run start:server

# Terminal 2: Frontend dev server
npm run dev

# Open http://127.0.0.1:5174
```

### Production Deployment
```bash
npm install
npm run build
HOST=0.0.0.0 PORT=3001 npm run serve:prod

# Open http://<server>:3001
```

## Testing the System

### Manual Recognition Test
1. Draw a simple expression (e.g., "x + 2")
2. Wait 450ms for debounce
3. Check math recognition card for result
4. Click "Recognize Math Now" to force immediate recognition

### Chat Integration Test
1. Ensure OpenAI/Claude API key is entered
2. Draw an expression
3. Ask: "What is on the board?"
4. Should return both the LaTeX and AI analysis

### Expression Question Test
1. Draw expression
2. Ask expression-related question
3. If recognized, should include LaTeX in context
4. Chat should reference the recognized math

## Architecture Decisions

### Why CoMER?
- Specialized for handwritten math expression recognition
- Trained on extensive math writing datasets
- Handles complex LaTeX structures (fractions, powers, integrals)
- Provides confidence scores for reliability estimation

### Why Python Worker?
- PyTorch/PyTorch Lightning models are Python-native
- Isolates model inference from Node.js event loop
- Allows GPU acceleration independently
- Easy model updates without Node restart

### Why Image-based Recognition?
- Preserves spatial relationships between symbols
- Captures stroke information
- More robust to drawing variations
- Works with any drawing tool (not limited to specific formats)

### Why Express Backend?
- Simple, lightweight routing
- Efficient for CPU-bound I/O (worker communication)
- Static file serving for production builds
- Easy to extend with additional endpoints

## Future Enhancements

1. **Multi-expression Recognition**
   - Segment into multiple math expressions
   - Recognize each separately
   - Combine into composite LaTeX

2. **Confidence-based Disambiguation**
   - Present alternatives when confidence is low
   - Allow user to select correct interpretation
   - Learn from user corrections

3. **Real-time Performance Analytics**
   - Track recognition latency
   - Monitor cache hit rates
   - Measure user satisfaction

4. **Advanced Preprocessing**
   - Automatic rotation correction
   - Handwriting style normalization
   - Ink pressure-sensitive processing

5. **Extended Chat Context**
   - Multi-turn conversation memory
   - Document-level context
   - Problem-solving workflow tracking
