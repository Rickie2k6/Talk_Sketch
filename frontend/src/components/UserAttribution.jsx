/**
 * User Attribution Display Component
 * Shows active users, their colors, and stroke counts
 */

export function UserAttributionPanel({ users, userColors, strokeStats, currentUserId }) {
  if (!users || users.length === 0) {
    return (
      <div className="user-attribution-panel">
        <div className="attribution-header">
          <h3>Active Users</h3>
          <span className="user-count">0</span>
        </div>
        <div className="no-users">No active users</div>
      </div>
    );
  }

  return (
    <div className="user-attribution-panel">
      <div className="attribution-header">
        <h3>Active Users</h3>
        <span className="user-count">{users.length}</span>
      </div>

      <div className="users-list">
        {users.map((user) => {
          const color = userColors.get(user) || '#cccccc';
          const strokes = strokeStats?.[user] || 0;
          const isCurrentUser = user === currentUserId;

          return (
            <div key={user} className="user-item">
              <div className="user-color-indicator" style={{ backgroundColor: color }} />
              <div className="user-info">
                <div className="user-name">
                  {user}
                  {isCurrentUser && <span className="badge-current">You</span>}
                </div>
                <div className="user-strokes">{strokes} strokes</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="attribution-footer">
        <div className="footer-info">
          Total users: {users.length}
        </div>
      </div>
    </div>
  );
}

export function StrokeProvenanceTooltip({ elementId, metadata }) {
  if (!metadata) {
    return null;
  }

  const createdDate = new Date(metadata.timestamp).toLocaleString();
  const lastModified = metadata.lastModifiedAt
    ? new Date(metadata.lastModifiedAt).toLocaleString()
    : 'Never';

  return (
    <div className="provenance-tooltip">
      <div className="provenance-header">Stroke Information</div>
      <div className="provenance-content">
        <div className="provenance-item">
          <span className="label">Creator:</span>
          <span className="value">
            {metadata.userId}
            <span
              className="color-dot"
              style={{ backgroundColor: metadata.color }}
            />
          </span>
        </div>
        <div className="provenance-item">
          <span className="label">Created:</span>
          <span className="value">{createdDate}</span>
        </div>
        {metadata.lastModifiedBy && (
          <div className="provenance-item">
            <span className="label">Last Modified By:</span>
            <span className="value">{metadata.lastModifiedBy}</span>
          </div>
        )}
        {metadata.deletedBy && (
          <div className="provenance-item deleted">
            <span className="label">Deleted By:</span>
            <span className="value">{metadata.deletedBy}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CollaborationStats({ stats }) {
  if (!stats) {
    return null;
  }

  return (
    <div className="collaboration-stats">
      <div className="stats-title">Collaboration Stats</div>
      <div className="stats-content">
        <div className="stat-row">
          <span className="stat-label">Total Strokes:</span>
          <span className="stat-value">{stats.totalStrokes || 0}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Total Changes:</span>
          <span className="stat-value">{stats.totalHistoryEvents || 0}</span>
        </div>
        {stats.strokesByUser && (
          <div className="stat-row">
            <span className="stat-label">Active Contributors:</span>
            <span className="stat-value">{Object.keys(stats.strokesByUser).length}</span>
          </div>
        )}
      </div>
    </div>
  );
}
