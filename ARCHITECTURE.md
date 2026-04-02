# Multi-User Collaboration System - Architecture & Data Flow

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TALK SKETCH APPLICATION                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │             REACT FRONTEND (src/)                     │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │                                                       │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐   │   │
│  │  │   App.jsx           │  │  Whiteboard.jsx     │   │   │
│  │  │  (Main Component)   │  │  (Excalidraw)       │   │   │
│  │  └─────────────────────┘  └─────────────────────┘   │   │
│  │           │                        │                  │   │
│  │           ▼                        ▼                  │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │         Core Managers (utils/)              │   │   │
│  │  ├──────────────────────────────────────────────┤   │   │
│  │  │                                              │   │   │
│  │  │  ┌──────────────────┐ ┌──────────────────┐  │   │   │
│  │  │  │UserColorManager  │ │StrokeAnnotator   │  │   │   │
│  │  │  └──────────────────┘ └──────────────────┘  │   │   │
│  │  │                                              │   │   │
│  │  │  ┌──────────────────────────────────────┐   │   │   │
│  │  │  │  CollaborationManager (WebSocket)   │   │   │   │
│  │  │  └──────────────────────────────────────┘   │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  │                    │                                 │   │
│  │  ┌────────────────▼────────────────┐               │   │
│  │  │  UI Components (components/)    │               │   │
│  │  ├─────────────────────────────────┤               │   │
│  │  │ • UserAttributionPanel          │               │   │
│  │  │ • StrokeProvenanceTooltip       │               │   │
│  │  │ • CollaborationStats            │               │   │
│  │  └─────────────────────────────────┘               │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                      │                                      │
│                      │ WebSocket                            │
│                      ▼                                      │
└─────────────────────────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌───────────────────┐       ┌───────────────────┐
│  NETWORK (WS)     │       │  BROWSER STORAGE  │
│  (Real-time)      │       │  (localStorage)   │
└─────────────────────      └───────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│              EXPRESS BACKEND (server/)                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        CollaborationServer                           │   │
│  │        (WebSocket Handler)                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                      │                                       │
│    ┌─────────────────┼─────────────────┐                    │
│    │                 │                 │                    │
│    ▼                 ▼                 ▼                    │
│  Session         User Color          Stroke                │
│  Manager         Manager             Metadata              │
│                                      Store                │
│                                                            │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow - Stroke Creation

```
User A draws stroke
    │
    ▼
Excalidraw element created (elementId)
    │
    ▼
App detects scene change via onChange
    │
    ▼
StrokeAnnotator.annotateStroke(elementId, userId, color, timestamp)
    │
    └─→ Stores: { elementId, userId, color, timestamp, ... }
    │
    ▼
CollaborationManager.broadcastStrokeCreated(metadata)
    │
    ▼
    WS: { type: 'stroke:created', payload: { ... } }
    │
    ├──→ CollaborationServer (Store & Distribute)
    │    │
    │    ├─→ Session storage
    │    │
    │    └─→ Broadcast to all users in session
    │
    └──→ User A (local): Update UI with stroke + color
    
    User B receives message
    │
    ▼
    StrokeAnnotator.annotateStroke(metadata)
    │
    ▼
    UI renders stroke with User A's color
    │
    ▼
    User hovers over stroke
    │
    ▼
    Display StrokeProvenanceTooltip
    │
    ▼
    Shows: Creator: User A [Color], Created: timestamp
```

## User Color Assignment Flow

```
User A Joins Session
    │
    ▼
CollaborationManager.connect('ws://...')
    │
    ▼
Send message: { type: 'user:join', payload: { userId, ... } }
    │
    ▼
Server receives join message
    │
    ├─→ Check if userId already has color
    │
    ├─→ If not: UserColorManager.assignColorToUser(userId)
    │
    │   Find available colors (palette - used colors)
    │   │
    │   └─→ Random selection from available
    │
    └─→ Store mapping: userId → color
    
Server broadcasts join event
    │
    ▼
    All connected clients receive:
    { type: 'user:joined', payload: { userId, color, ... } }
    │
    ├─→ User A: Local state
    │   └─→ userColorManager.assignColorToUser(userId, color)
    │
    └─→ User B: Remote discovery
        └─→ Add to active users panel
        └─→ Update colors map

Result: All users see consistent userId → color mapping
        Strokes drawn by User A are colored consistently
```

## Concurrent Multi-User Scenario

```
Timeline: T=0

T=0.0s: User A & B connected (different colors)
        Palette state: [RED(A), BLUE(B), YELLOW*, GREEN*, ...]

T=1.5s: User A draws Stroke 1
        │
        StrokeAnnotator: { id: elem1, userId: A, color: RED }
        │
        Broadcast: stroke:created
        │
        └─→ User B receives & displays Stroke 1 in RED

T=2.2s: User B draws Stroke 2 (overlaps Stroke 1)
        │
        StrokeAnnotator: { id: elem2, userId: B, color: BLUE }
        │
        Broadcast: stroke:created
        │
        └─→ User A receives & displays Stroke 2 in BLUE

Visual Result on Both Screens:
┌──────────────────────────┐
│  Stroke 1 (RED - User A) │ ←──┐
│    ╱╱╱╱╱╱╱╱╱╱╱╱         │    │ Real-time
│    ╲╲╲╲╲╲╲╲╲             │    │ Visual
│  Stroke 2 (BLUE - User B) │ ←──┤ Diff
└──────────────────────────┘    │
                                │
T=3.0s: User B queries Stroke 1 │
        │                       │
        StrokeAnnotator.getStrokeMetadata(elem1)
        │
        └─→ Returns: { userId: A, color: RED, timestamp: T=1.5s, ... }
        
UI Displays:
┌─────────────────────────────────────┐
│       STROKE INFORMATION            │
├─────────────────────────────────────┤
│ Creator: User A [■ RED]             │
│ Created: 2026-04-02 10:15:30        │
│ Last Modified: Never                │
└─────────────────────────────────────┘
```

## Color Palette Management

```
Available Colors (16 total):
┌────────────────────────────────────────────────────┐
│ #FF6B6B (Red)      │ #4ECDC4 (Teal)               │
│ #45B7D1 (Blue)     │ #FFA07A (Light Salmon)       │
│ #98D8C8 (Mint)     │ #F7DC6F (Yellow)             │
│ #BB8FCE (Purple)   │ #85C1E2 (Light Blue)         │
│ #F8B88B (Peach)    │ #A9D6E5 (Powder Blue)        │
│ #EAA29B (Dusty)    │ #B4E7E7 (Aquamarine)         │
│ #FFB6B9 (Light)    │ #8FD14F (Green)              │
│ #FF9999 (Salmon)   │ #FFEAA7 (Light Yellow)       │
└────────────────────────────────────────────────────┘

Assignment Process:

Session Start
    │
    ├─ Palette = [16 colors all available]
    │
    ▼
User 1 Joins
    │
    ├─ Random select from 16 colors
    ├─ Assign: User1 → RED
    ├─ Available: 15 colors
    │
    ▼
User 2 Joins
    │
    ├─ Random select from 15 colors
    ├─ Assign: User2 → BLUE
    ├─ Available: 14 colors
    │
    ▼
...
    │
    ▼
User 16 Joins
    │
    ├─ Random select from 1 color
    ├─ Assign: User16 → last color
    ├─ Available: 0 colors
    │
    ▼
User 17 Joins (beyond palette)
    │
    ├─ WARNING: All colors exhausted
    ├─ Fallback: Random from all colors (potential collision)
    ├─ But still functional - server prevents duplicate userId assignments
```

## Message Routing

```
Local Event (User A)
    │
    ├─→ Excalidraw: Stroke created
    │
    ├─→ App.jsx: Detects scene change
    │
    ├─→ StrokeAnnotator: Annotate with metadata
    │
    ├─→ CollaborationManager.send()
    │
    └─→ WebSocket.send(JSON.stringify(message))
    
─────────────────────────────────────

Server (CollaborationServer)
    │
    ├─→ ws.onmessage(data)
    │
    ├─→ Parse JSON
    │
    ├─→ Route by message.type:
    │   ├─ 'stroke:created'  → handleStrokeCreated()
    │   ├─ 'stroke:modified' → handleStrokeModified()
    │   ├─ 'user:join'       → handleUserJoin()
    │   └─ ... (10+ handlers)
    │
    ├─→ Store in state/database
    │
    └─→ broadcastToSession()
        │
        └─→ Send to all clients in session
        
─────────────────────────────────────

Remote Event (User B)
    │
    ├─→ WebSocket.onmessage(data)
    │
    ├─→ CollaborationManager.handleMessage()
    │
    ├─→ Route by type:
    │   
    │   'stroke:created'
    │   │
    │   ├─→ Emit: 'message:stroke:created'
    │   │
    │   └─→ Call registered handlers
    │       │
    │       ├─→ StrokeAnnotator.annotateStroke()
    │       │
    │       └─→ UI: Render with User A's color
    │
    └─→ Update state
```

## Session State Consistency

```
Server Maintains:
┌──────────────────────────────────────┐
│ CURRENT SESSION STATE                │
├──────────────────────────────────────┤
│                                      │
│ Users in Session:                    │
│ ├─ userId: user1, color: #FF6B6B    │
│ ├─ userId: user2, color: #4ECDC4    │
│ └─ userId: user3, color: #45B7D1    │
│                                      │
│ Strokes Map:                         │
│ ├─ elem1: {creator: user1, ...}      │
│ ├─ elem2: {creator: user2, ...}      │
│ └─ elem3: {creator: user1, ...}      │
│                                      │
│ Session Metadata:                    │
│ ├─ createdAt: timestamp              │
│ ├─ activeUsers: 3                    │
│ └─ totalStrokes: 3                   │
│                                      │
└──────────────────────────────────────┘

Client A Sends Modification
    │
    ├─→ stroke:modified message
    │
    └─→ Server updates: elem2.lastModifiedBy = user1
    
    Server broadcasts to all clients
    │
    ├─→ Client A: Local update
    ├─→ Client B: Remote update
    └─→ Client C: Remote update
    
Result: All clients consistent with server state
```

## Sequence Diagram - 3-User Collaboration

```
Time    User A          Server              User B          User C
│       │               │                   │               │
├─────► │ join          │                   │               │
│       │───────────────►│                   │               │
│       │◄───────────────│ assign color      │               │
│       │ RED            │ broadcast join    │               │
│       │                │────────────────►  │               │
│       │                │                   │ display (RED) │
│       │                │                   │               │
├─────► │               │ ◄─────────────────│ join          │
│       │                │                   │───────────────►
│       │                │ assign color      │ assign color  │
│       │                │ BLUE             │                │
│       │                │ broadcast join    │                │
│       │                │───────────────────┼──────────────►│
│       │                │                   │               │
│       │ draw stroke 1  │                   │               │
├─────► │ (elem1)        │                   │               │
│       │─ annotate ────► stroke:created    │               │
│       │                │────────────────►  │               │
│       │                │  + broadcast   ───┼──────────────►│
│       │                │                   │ display RED   │
│       │                │                   │               │
├─────► │                │                   │ draw stroke 2 │
│       │                │                   │ (elem2)       │
│       │ ◄──────────────┼───────────────────┤               │
│       │ stroke:created │                   │─→ server      │
│       │ (BLUE)         │ stroke:created    │               │
│       │ display        │◄─────────────────┤               │
│       │                │ broadcast ────────┼──────────────►│
│       │                │                   │ display BLUE  │
│       │                │   (elem1, BLUE)   │ (elem2, BLUE) │
│       │                │                   │               │
└───────┴────────────────┴───────────────────┴───────────────┘

Result: All 3 clients see identical state:
- Stroke 1 in RED (User A created)
- Stroke 2 in BLUE (User B created)
- All users see both strokes with correct colors
- Hover over stroke shows creator info
```

## Error Recovery & Reconnection

```
Network Disconnected (User A)
    │
    ├─→ WebSocket disconnects
    │
    ├─→ CollaborationManager triggers reconnect
    │   └─→ Exponential backoff (1s → 2s → 4s → 8s...)
    │
    ├─→ Attempt 1 (1s) ─→ Fail
    ├─→ Attempt 2 (2s) ─→ Fail
    ├─→ Attempt 3 (4s) ─→ Success
    │
    ├─→ User A reconnects
    │
    ├─→ Server receives 'user:join' from User A
    │
    ├─→ Server sends 'fullState' with:
    │   ├─ All active users
    │   ├─ All current strokes
    │   └─ All user colors
    │
    ├─→ User A's local state synced
    │
    └─→ Collaboration resumed seamlessly
```

---

**This architecture ensures:**
- Real-time multi-user collaboration
- Consistent user-color mappings
- Complete provenance tracking
- High performance
- Robustness to network issues
- Scalability to 16+ concurrent users
