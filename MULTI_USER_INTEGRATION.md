# Multi-User Collaboration - Integration Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install ws
```

### 2. Initialize Server Components

Update `server.js`:

```javascript
import CollaborationServer from './server/collaborationServer.js';
import http from 'http';

// Create HTTP server
const server = http.createServer(app);

// Initialize collaboration server
const collaborationServer = new CollaborationServer(server);

// Start server
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`WebSocket collaboration available at ws://${HOST}:${PORT}`);
});
```

### 3. Initialize Client Components

Update `src/App.jsx`:

```javascript
import UserColorManager from './utils/userColorManager';
import StrokeAnnotator from './utils/strokeAnnotator';
import CollaborationManager from './utils/collaborationManager';
import { UserAttributionPanel, CollaborationStats } from './components/UserAttribution';
import './styles/userAttribution.css';

// Generate or retrieve user ID
function generateSessionUserId() {
  let sessionId = sessionStorage.getItem('sessionUserId');
  if (!sessionId) {
    sessionId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('sessionUserId', sessionId);
  }
  return sessionId;
}

function App() {
  const [userId] = useState(() => generateSessionUserId());
  const [userColorManager] = useState(() => new UserColorManager());
  const [strokeAnnotator] = useState(() => new StrokeAnnotator());
  const [collaboration, setCollaboration] = useState(null);
  
  const [activeUsers, setActiveUsers] = useState([]);
  const [userColors, setUserColors] = useState(new Map());
  const [strokeStats, setStrokeStats] = useState({});
  const [collaborationStats, setCollaborationStats] = useState(null);

  // Initialize collaboration
  useEffect(() => {
    const initCollaboration = async () => {
      const userColor = userColorManager.assignColorToUser(userId);
      const collab = new CollaborationManager(userId);

      // Listen for remote strokes
      collab.onMessage('stroke:created', (payload) => {
        strokeAnnotator.annotateStroke(
          payload.elementId,
          payload.userId,
          payload.color,
          payload.timestamp
        );
      });

      collab.onMessage('stroke:modified', (payload) => {
        strokeAnnotator.markStrokeModified(
          payload.elementId,
          payload.lastModifiedBy,
          payload.lastModified
        );
      });

      collab.onMessage('stroke:deleted', (payload) => {
        strokeAnnotator.markStrokeDeleted(
          payload.elementId,
          payload.deletedBy,
          payload.deletedAt
        );
      });

      // Listen for user join events
      window.addEventListener('message:user:joined', (e) => {
        const { userId: joinedUserId, color } = e.detail;
        userColorManager.assignColorToUser(joinedUserId);
        
        setActiveUsers(prev => {
          if (!prev.includes(joinedUserId)) {
            return [...prev, joinedUserId];
          }
          return prev;
        });

        setUserColors(new Map(userColorManager.getAllUserColors()));
      });

      // Listen for user leave events
      window.addEventListener('message:user:left', (e) => {
        const { userId: leftUserId } = e.detail;
        userColorManager.removeUser(leftUserId);
        
        setActiveUsers(prev => prev.filter(id => id !== leftUserId));
        setUserColors(new Map(userColorManager.getAllUserColors()));
      });

      // Connect to server
      const wsUrl = `ws://${window.location.hostname}:${window.location.port || 3001}`;
      try {
        await collab.connect(wsUrl);
        setCollaboration(collab);
        
        // Request full session state
        collab.requestFullState();
      } catch (error) {
        console.error('Failed to connect to collaboration server:', error);
      }
    };

    initCollaboration();

    return () => {
      if (collaboration) {
        collaboration.disconnect();
      }
    };
  }, []);

  // Handle Excalidraw stroke creation
  const handleSceneChange = (elements) => {
    // ... existing logic ...

    // Annotate new strokes
    elements.forEach(element => {
      if (!strokeAnnotator.getStrokeMetadata(element.id)) {
        if (element.type === 'freedraw' || element.type === 'draw') {
          const userColor = userColorManager.getColorForUser(userId);
          const metadata = strokeAnnotator.annotateStroke(
            element.id,
            userId,
            userColor,
            Date.now()
          );

          // Broadcast stroke creation
          if (collaboration) {
            collaboration.broadcastStrokeCreated(metadata);
          }
        }
      }
    });

    // Update stats
    setStrokeStats(strokeAnnotator.getStatistics().strokesByUser || {});
    setCollaborationStats(strokeAnnotator.getStatistics());
  };

  return (
    <div className="app-shell">
      <div className="board-area">
        <Whiteboard 
          onApiReady={setExcalidrawAPI} 
          onSceneChange={handleSceneChange} 
        />
      </div>

      <aside className="side-panel">
        {/* User Attribution Panel */}
        <UserAttributionPanel
          users={activeUsers}
          userColors={userColors}
          strokeStats={strokeStats}
          currentUserId={userId}
        />

        {/* Collaboration Stats */}
        <CollaborationStats stats={collaborationStats} />

        {/* Existing chat panel... */}
      </aside>
    </div>
  );
}
```

## Integration with Excalidraw

### Track Stroke Creation

```javascript
// In Excalidraw onChange handler
const handleExcalidrawChange = (elements, appState, files) => {
  const newElements = elements.filter(el => !el.isDeleted);
  
  newElements.forEach(element => {
    // Check if this is a new stroke we haven't tracked
    if (!trackedElements.has(element.id)) {
      // Assign metadata
      const metadata = strokeAnnotator.annotateStroke(
        element.id,
        userId,
        userColor,
        Date.now()
      );

      // Broadcast to collaborators
      collaboration?.broadcastStrokeCreated(metadata);

      // Track this element
      trackedElements.add(element.id);

      // Store element metadata in a custom field (if supported)
      element._createdBy = userId;
      element._color = userColor;
      element._strokeMetadata = metadata;
    }
  });
};
```

### Render Attribution Markers

```javascript
// Add visual indicators for stroke creators
function renderStrokeAttribution(element, metadata) {
  if (!metadata) return;

  // Apply styling
  const style = {
    stroke: metadata.color,
    strokeWidth: 2,
    opacity: 0.8,
  };

  // Add tooltip on hover
  return (
    <g className="stroke-attribution">
      <title>{`Created by ${metadata.userId}`}</title>
      {/* Render element with assigned color */}
    </g>
  );
}
```

## Advanced Usage

### Export Collaboration Session

```javascript
function exportSession() {
  const sessionData = {
    userId,
    activeUsers: Array.from(userColorManager.getAllUserColors()),
    strokes: strokeAnnotator.exportData(),
    exportedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(sessionData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `collaboration-session-${Date.now()}.json`;
  a.click();
}
```

### Restore Session

```javascript
async function restoreSession(sessionFile) {
  const json = await sessionFile.text();
  const sessionData = JSON.parse(json);

  // Restore user colors
  for (const [userId, color] of Object.entries(sessionData.activeUsers)) {
    userColorManager.assignColorToUser(userId);
  }

  // Restore strokes
  strokeAnnotator.importData(sessionData.strokes);

  console.log('Session restored');
}
```

### Generate Provenance Report

```javascript
function generateProvenanceReport() {
  const stats = strokeAnnotator.getStatistics();
  const history = strokeAnnotator.getHistory();

  const report = {
    generatedAt: new Date().toISOString(),
    session: {
      totalStrokes: stats.totalStrokes,
      contributors: Object.keys(stats.strokesByUser || {}),
      changes: stats.totalHistoryEvents,
    },
    timeline: history.map(event => ({
      timestamp: event.created,
      action: event.action,
      element: event.elementId,
      user: event.userId,
      color: event.color,
    })),
    contributorStats: stats.strokesByUser,
  };

  return report;
}
```

## Real-Time Features

### Cursor Tracking

```javascript
function setupCursorTracking(collaboration) {
  document.addEventListener('mousemove', throttle((e) => {
    collaboration.broadcastCursorPosition({
      x: e.clientX,
      y: e.clientY,
    });
  }, 100)); // Throttle to 100ms

  // Listen for remote cursors
  collaboration.onMessage('cursor:moved', ({ userId, x, y }) => {
    renderRemoteCursor(userId, x, y, userColors.get(userId));
  });
}
```

### Presence Indicators

```javascript
function setupPresence(collaboration) {
  collaboration.broadcastPresence({
    action: 'idle',
    lastActivity: Date.now(),
  });

  window.addEventListener('mousemove', () => {
    collaboration.broadcastPresence({
      action: 'drawing',
      lastActivity: Date.now(),
    });
  });
}
```

## Performance Tips

1. **Throttle Updates**: Use throttle/debounce for cursor and presence updates
2. **Batch Strokes**: Group stroke metadata updates when possible
3. **Memory Management**: Clear old history periodically
4. **Connection Pooling**: Reuse collaboration connections
5. **Lazy Loading**: Load provenance data on demand

## Troubleshooting

### WebSocket Connection Issues

```javascript
collab.onMessage('connectionFailed', (data) => {
  console.error('Connection failed:', data.reason);
  // Show fallback UI or retry logic
});
```

### Sync Issues

```javascript
// Request full state if out of sync
function resyncWithServer() {
  collaboration.requestFullState();
  console.log('Requesting full sync from server');
}

// Call when detecting inconsistencies
setInterval(() => {
  const localStats = strokeAnnotator.getStatistics();
  // Compare with expected state and resync if needed
}, 30000);
```

### Color Collision Detection

```javascript
function checkColorCollisions() {
  const palette = userColorManager.getPalette();
  const activeUsers = userColorManager.getActiveUsers();
  
  if (activeUsers.length > palette.length) {
    console.warn(
      `Color collision warning: ${activeUsers.length} users, only ${palette.length} colors`
    );
  }
}
```

## Testing

### Unit Tests

```javascript
// Test color assignment
const colorManager = new UserColorManager();
const color1 = colorManager.assignColorToUser('user1');
const color2 = colorManager.assignColorToUser('user2');
assert(color1 !== color2, 'Colors should be different');

// Test stroke annotation
const annotator = new StrokeAnnotator();
const metadata = annotator.annotateStroke('elem1', 'user1', '#FF6B6B');
assert(metadata.elementId === 'elem1', 'ElementId should match');
```

### Integration Tests

```javascript
// Test multi-user flow
async function testMultiUserFlow() {
  const collab1 = new CollaborationManager('user1');
  const collab2 = new CollaborationManager('user2');

  await collab1.connect('ws://localhost:3001');
  await collab2.connect('ws://localhost:3001');

  // Simulate stroke creation
  collab1.broadcastStrokeCreated({
    elementId: 'stroke1',
    userId: 'user1',
    color: '#FF6B6B',
    timestamp: Date.now(),
  });

  // Verify user2 receives update
  const received = await new Promise(resolve => {
    collab2.onMessage('stroke:created', resolve);
  });

  assert(received.elementId === 'stroke1');
}
```

## Security Considerations

1. **User Validation**: Validate userId on server
2. **Stroke Ownership**: Verify user can only create strokes they own
3. **Deletion Rights**: Enforce permissions for stroke deletion
4. **Data Sanitization**: Sanitize all user input
5. **Rate Limiting**: Limit message frequency to prevent abuse

---

**Ready to deploy!** Follow the steps above to integrate multi-user collaboration into your Talk Sketch application.
