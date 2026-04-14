import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildRoomPath, createRoomId, normalizeRoomId } from "./utils/collaborationIdentity.js";

export default function HomePage() {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextRoomId = normalizeRoomId(roomName || createRoomId());
    navigate(buildRoomPath(nextRoomId));
  };

  const handleCreateRoom = () => {
    navigate(buildRoomPath(createRoomId()));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#eef1f7",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "min(420px, 100%)",
          display: "grid",
          gap: "14px",
          padding: "24px",
          borderRadius: "18px",
          border: "1px solid #d8deeb",
          background: "#ffffff",
          boxShadow: "0 10px 28px rgba(31, 42, 68, 0.08)",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 8px", color: "#1f2a44", fontSize: "28px" }}>Talk Sketch Rooms</h1>
          <p style={{ margin: 0, color: "#6f7b99", lineHeight: 1.5 }}>
            Join an existing whiteboard or create a new room to share.
          </p>
        </div>
        <input
          type="text"
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          placeholder="Enter room name"
          style={{
            border: "1px solid #cbd4ea",
            borderRadius: "12px",
            padding: "12px 14px",
            font: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="submit"
            style={{
              border: "1px solid #2f5bff",
              borderRadius: "12px",
              padding: "12px 16px",
              font: "inherit",
              fontWeight: 600,
              color: "#ffffff",
              background: "#2f5bff",
              cursor: "pointer",
            }}
          >
            Create / Join
          </button>
          <button
            type="button"
            onClick={handleCreateRoom}
            style={{
              border: "1px solid #c4cfeb",
              borderRadius: "12px",
              padding: "12px 16px",
              font: "inherit",
              fontWeight: 600,
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            New Random Room
          </button>
        </div>
      </form>
    </div>
  );
}
