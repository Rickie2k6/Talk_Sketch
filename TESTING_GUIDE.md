# Multi-User Collaboration - Testing & Validation Guide

## Testing Checklist

### 1. Color Assignment Tests

#### Test 1.1: Single User Color Assignment
```javascript
// Expected: User gets unique color
const colorMgr = new UserColorManager();
const color1 = colorMgr.assignColorToUser('user1');
ASSERT(color1 !== undefined);
ASSERT(typeof color1 === 'string');
ASSERT(color1.match(/^#[0-9A-F]{6}$/i));
```

#### Test 1.2: Multiple Users Get Different Colors
```javascript
const colorMgr = new UserColorManager();
const color1 = colorMgr.assignColorToUser('user1');
const color2 = colorMgr.assignColorToUser('user2');
const color3 = colorMgr.assignColorToUser('user3');

ASSERT(color1 !== color2);
ASSERT(color2 !== color3);
ASSERT(color1 !== color3);
```

#### Test 1.3: Repeated Assignment Returns Same Color
```javascript
const colorMgr = new UserColorManager();
const color1a = colorMgr.assignColorToUser('user1');
const color1b = colorMgr.assignColorToUser('user1');

ASSERT(color1a === color1b);
```

#### Test 1.4: All 16 Colors Can Be Assigned
```javascript
const colorMgr = new UserColorManager();
const colors = new Set();

for (let i = 0; i < 16; i++) {
  const color = colorMgr.assignColorToUser(`user${i}`);
  colors.add(color);
}

ASSERT_EQUAL(colors.size, 16);
```

#### Test 1.5: User Removal Frees Color
```javascript
const colorMgr = new UserColorManager();
const color1 = colorMgr.assignColorToUser('user1');

// All users assigned
for (let i = 1; i < 16; i++) {
  colorMgr.assignColorToUser(`user${i}`);
}

const available1 = colorMgr.getAvailableColorsCount();
ASSERT_EQUAL(available1, 0);

// Remove user1
colorMgr.removeUser('user1');

const available2 = colorMgr.getAvailableColorsCount();
ASSERT_EQUAL(available2, 1);

// Can reuse color1
const newColor = colorMgr.assignColorToUser('user17');
ASSERT(newColor !== undefined);
```

### 2. Stroke Annotation Tests

#### Test 2.1: Basic Stroke Annotation
```javascript
const annotator = new StrokeAnnotator();
const metadata = annotator.annotateStroke('elem1', 'user1', '#FF6B6B', 1000);

ASSERT_EQUAL(metadata.elementId, 'elem1');
ASSERT_EQUAL(metadata.userId, 'user1');
ASSERT_EQUAL(metadata.color, '#FF6B6B');
ASSERT_EQUAL(metadata.timestamp, 1000);
```

#### Test 2.2: Retrieve Stroke Metadata
```javascript
const annotator = new StrokeAnnotator();
annotator.annotateStroke('elem1', 'user1', '#FF6B6B', 1000);

const metadata = annotator.getStrokeMetadata('elem1');
ASSERT(metadata !== null);
ASSERT_EQUAL(metadata.userId, 'user1');
```

#### Test 2.3: Mark Stroke Modified
```javascript
const annotator = new StrokeAnnotator();
annotator.annotateStroke('elem1', 'user1', '#FF6B6B', 1000);
annotator.markStrokeModified('elem1', 'user2', 2000);

const metadata = annotator.getStrokeMetadata('elem1');
ASSERT_EQUAL(metadata.lastModifiedBy, 'user2');
ASSERT_EQUAL(metadata.lastModified, 2000);
```

#### Test 2.4: Mark Stroke Deleted
```javascript
const annotator = new StrokeAnnotator();
annotator.annotateStroke('elem1', 'user1', '#FF6B6B', 1000);
annotator.markStrokeDeleted('elem1', 'user2', 2000);

const metadata = annotator.getStrokeMetadata('elem1');
ASSERT_EQUAL(metadata.deleted, true);
ASSERT_EQUAL(metadata.deletedBy, 'user2');
```

#### Test 2.5: Get History
```javascript
const annotator = new StrokeAnnotator();
annotator.annotateStroke('elem1', 'user1', '#FF6B6B', 1000);
annotator.markStrokeModified('elem1', 'user2', 2000);

const history = annotator.getHistory();
ASSERT(history.length >= 2);
ASSERT(history.some(e => e.action === 'created'));
ASSERT(history.some(e => e.action === 'modified'));
```

### 3. WebSocket Communication Tests

#### Test 3.1: Connect to Server
```javascript
const collab = new CollaborationManager('user1');
const connected = await collab.connect('ws://localhost:3001');

ASSERT(collab.isConnected);
```

#### Test 3.2: Send Stroke Created
```javascript
const collab = new CollaborationManager('user1');
await collab.connect('ws://localhost:3001');

const stroke = {
  elementId: 'elem1',
  userId: 'user1',
  color: '#FF6B6B',
  timestamp: Date.now(),
};

collab.broadcastStrokeCreated(stroke);
// Should not throw
```

#### Test 3.3: Receive Remote Stroke
```javascript
const collab1 = new CollaborationManager('user1');
const collab2 = new CollaborationManager('user2');

await collab1.connect('ws://localhost:3001');
await collab2.connect('ws://localhost:3001');

let receivedStroke = null;
collab2.onMessage('stroke:created', (payload) => {
  receivedStroke = payload;
});

const stroke = {
  elementId: 'elem1',
  userId: 'user1',
  color: '#FF6B6B',
  timestamp: Date.now(),
};

collab1.broadcastStrokeCreated(stroke);

// Wait for message delivery
await sleep(100);

ASSERT(receivedStroke !== null);
ASSERT_EQUAL(receivedStroke.elementId, 'elem1');
```

#### Test 3.4: Reconnection
```javascript
const collab = new CollaborationManager('user1');
await collab.connect('ws://localhost:3001');

ASSERT(collab.isConnected);

// Simulate disconnect
collab.ws.close();
await sleep(100);

ASSERT(!collab.isConnected);

// Should attempt reconnection
await sleep(2000);

// Should be connected or attempting
ASSERT(collab.reconnectAttempts > 0);
```

### 4. Integration Tests

#### Test 4.1: Full Multi-User Workflow
```javascript
// Setup 2 users
const user1ColorMgr = new UserColorManager();
const user2ColorMgr = new UserColorManager();

const user1Annotator = new StrokeAnnotator();
const user2Annotator = new StrokeAnnotator();

const user1Color = user1ColorMgr.assignColorToUser('user1');
const user2Color = user2ColorMgr.assignColorToUser('user2');

// User 1 draws
const stroke1 = user1Annotator.annotateStroke(
  'elem1',
  'user1',
  user1Color,
  1000
);

// Simulate server sync to user 2
user2Annotator.annotateStroke(
  'elem1',
  'user1',
  user1Color,
  1000
);

// User 2 draws
const stroke2 = user2Annotator.annotateStroke(
  'elem2',
  'user2',
  user2Color,
  2000
);

// Simulate server sync to user 1
user1Annotator.annotateStroke(
  'elem2',
  'user2',
  user2Color,
  2000
);

// Both users have consistent view
const user1Stats = user1Annotator.getStatistics();
const user2Stats = user2Annotator.getStatistics();

ASSERT_EQUAL(user1Stats.totalStrokes, 2);
ASSERT_EQUAL(user2Stats.totalStrokes, 2);
```

### 5. Performance Tests

#### Test 5.1: Rapid Stroke Creation
```javascript
const annotator = new StrokeAnnotator();
const startTime = Date.now();

for (let i = 0; i < 1000; i++) {
  annotator.annotateStroke(
    `elem${i}`,
    `user${i % 10}`,
    '#FF6B6B',
    startTime + i
  );
}

const elapsed = Date.now() - startTime;
ASSERT(elapsed < 100); // Should be fast
```

#### Test 5.2: Large History Query
```javascript
const annotator = new StrokeAnnotator();

// Create many strokes
for (let i = 0; i < 100; i++) {
  annotator.annotateStroke(`elem${i}`, `user1`, '#FF6B6B', i * 100);
  annotator.markStrokeModified(`elem${i}`, `user2`, i * 100 + 50);
}

const startTime = Date.now();
const history = annotator.getHistory();
const elapsed = Date.now() - startTime;

ASSERT(elapsed < 10); // Should be fast
ASSERT(history.length >= 200); // Created + modified events
```

### 6. UI Component Tests

#### Test 6.1: UserAttributionPanel Renders
```javascript
const { render } = require('@testing-library/react');
const UserAttributionPanel = require('./UserAttribution').UserAttributionPanel;

const users = ['user1', 'user2', 'user3'];
const userColors = new Map([
  ['user1', '#FF6B6B'],
  ['user2', '#4ECDC4'],
  ['user3', '#45B7D1'],
]);
const strokeStats = { user1: 5, user2: 3, user3: 7 };

const { container } = render(
  <UserAttributionPanel
    users={users}
    userColors={userColors}
    strokeStats={strokeStats}
    currentUserId="user1"
  />
);

const items = container.querySelectorAll('.user-item');
ASSERT_EQUAL(items.length, 3);
```

#### Test 6.2: Provenance Tooltip Displays
```javascript
const { render } = require('@testing-library/react');
const { StrokeProvenanceTooltip } = require('./UserAttribution');

const metadata = {
  elementId: 'elem1',
  userId: 'user1',
  color: '#FF6B6B',
  timestamp: 1000,
  created: '2026-04-02T10:00:00Z',
};

const { container } = render(
  <StrokeProvenanceTooltip elementId="elem1" metadata={metadata} />
);

ASSERT(container.textContent.includes('user1'));
ASSERT(container.textContent.includes('Creator'));
```

## Manual Testing

### Setup Local Test

1. Start server:
```bash
npm run serve:prod
```

2. Open 2 browser windows to `http://localhost:3001`

3. Assign distinct user IDs (via localStorage):
```javascript
// Window 1
sessionStorage.setItem('sessionUserId', 'Alice');

// Window 2
sessionStorage.setItem('sessionUserId', 'Bob');
```

### Test Scenarios

**Scenario 1: Concurrent Drawing**
1. Alice draws a stroke
2. Verify Bob sees stroke in Alice's color immediately
3. Bob draws a stroke
4. Verify Alice sees stroke in Bob's color immediately
5. Hover over each stroke, verify creator info

**Scenario 2: Modification Tracking**
1. Alice creates stroke
2. Bob modifies Alice's stroke
3. Hover over stroke
4. Verify "Last Modified By: Bob" shown

**Scenario 3: User Join/Leave**
1. Alice and Bob drawing (2 users visible in panel)
2. Alice refreshes page
3. Verify panel shows only Bob temporarily
4. Alice reconnects
5. Verify panel shows 2 users again

**Scenario 4: Color Consistency**
1. Alice's strokes: Color A
2. Bob's strokes: Color B
3. Check UserAttributionPanel
4. Verify colors match drawer assignments
5. Reload page
6. Verify same colors persist for same users

**Scenario 5: History Export**
1. Create several strokes
2. Export history as JSON
3. Verify exported data contains:
   - All element IDs
   - User IDs and colors
   - Timestamps
   - Modification history

## Continuous Integration

### Automated Tests
```bash
npm run test:multi-user
```

### Test Coverage
- Unit tests: 95%+ coverage
- Integration tests: 80%+ coverage
- E2E tests: Critical paths covered

### Performance Benchmarks
- Stroke annotation: <1ms
- Server broadcast: <50ms
- Client update: <100ms

## Validation Checklist

- [ ] Color assignment works (no collisions for ≤16 users)
- [ ] Strokes annotated with creator info
- [ ] Multi-user drawing synchronized in real-time
- [ ] User attribution panel displays correctly
- [ ] Provenance tooltips show complete history
- [ ] Reconnection works after network failure
- [ ] History can be exported and restored
- [ ] Performance meets benchmarks
- [ ] UI is responsive on mobile
- [ ] No memory leaks in long sessions

## Known Limitations & Workarounds

| Issue | Workaround |
|-------|-----------|
| >16 concurrent users | Color reuse with potential collision (non-breaking) |
| Long disconnect | Manual page reload to sync state |
| High latency (>1s) | Consider operational transformation for conflict resolution |
| Large sessions (>100 strokes) | Implement stroke pruning/archiving |

---

**Testing complete when all tests pass and validation checklist is marked.**
