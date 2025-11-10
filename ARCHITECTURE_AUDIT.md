# Architecture Audit: Real-Time Collaboration & Loading Patterns

## Executive Summary

**Overall Assessment**: The architecture is solid but has opportunities for simplification, better organization, and performance optimization.

**Key Scores**:
- Performance: 7.5/10 (good but can be optimized)
- Stale Data Risk: 1/10 (excellent after recent fixes)
- Code Organization: 6/10 (functional but could be cleaner)
- Maintainability: 5/10 (large files, some duplication)

---

## 🔴 Critical Issues

### 1. Provider Models Re-fetched on Every Workspace Switch
**Location**: `apps/sim/app/workspace/[workspaceId]/providers/workspace-initializer.tsx:225-227`

**Problem**:
```typescript
fetchModels('base'),
fetchModels('ollama'),
fetchModels('openrouter'),
```

These are **global, user-scoped models** (not workspace-specific), but we fetch them on EVERY workspace initialization. If user switches between 5 workspaces, we fetch the same data 5 times.

**Impact**:
- Unnecessary network requests
- Slower workspace switching
- Potential race conditions

**Solution**:
```typescript
// Option 1: Add hasLoadedOnce flag to provider store
const { fetchModels, hasLoadedModels } = useProvidersStore()

// In Phase 2, conditionally fetch:
...(!hasLoadedModels('base') && fetchModels('base')),
...(!hasLoadedModels('ollama') && fetchModels('ollama')),
...(!hasLoadedModels('openrouter') && fetchModels('openrouter')),

// Option 2: Move to app-level initialization (outside workspace)
// Fetch once when app loads, not per workspace
```

---

## 🟡 High Priority Issues

### 2. Inconsistent Cache Clearing Signatures
**Location**: Multiple stores

**Problem**:
- `clearWorkspaceEnvCache(workspaceId?: string)` - Accepts workspaceId, workspace-specific clearing
- `clearKnowledgeBasesList()` - No parameters, clears everything
- `clearWorkflowsCache(workspaceId?: string)` - Accepts workspaceId but doesn't use it, clears everything

**Impact**:
- Developer confusion about intended behavior
- clearWorkflowsCache accepts a parameter it doesn't use (misleading signature)

**Solution**:
```typescript
// Option 1: Make all consistent (workspace-specific)
clearKnowledgeBasesList(workspaceId?: string)
clearWorkflowsCache(workspaceId?: string) // Actually use the parameter

// Option 2: Make all consistent (global clear)
clearWorkspaceEnvCache() // Remove workspace parameter
clearKnowledgeBasesList()
clearWorkflowsCache()

// RECOMMENDED: Option 2 - since we refetch with workspaceId filter anyway
```

**Rationale**: After clearing cache, we call `fetchFunction(workspaceId)` which filters by workspace on the server. So clearing everything is fine and simpler.

### 3. Unused Return Value from useCollaborativeWorkspace
**Location**: `apps/sim/hooks/use-collaborative-workspace.ts:212-215`

**Problem**:
```typescript
return {
  isConnected,
  currentWorkspaceId: workspaceId,
}
```

This return value is **never used anywhere**. It's called only in workspace-initializer and the return is ignored.

**Solution**: Remove the return value entirely
```typescript
export function useCollaborativeWorkspace(workspaceId: string | undefined): void {
  // ... implementation
  // No return statement
}
```

### 4. Outdated Documentation
**Location**: `apps/sim/hooks/use-collaborative-workspace.ts:62`

**Problem**:
```typescript
// Listens for socket events and automatically refetches data when other users
// make changes to environment variables, custom tools, folders, MCP servers,
// knowledge bases, or workflows in the same workspace.
//                   ^^^^^^^^^^^^ - This is wrong, we removed knowledge base collaboration
```

**Solution**: Update docstring to remove knowledge bases

---

## 🟢 Medium Priority Issues

### 5. Factory Pattern May Be Over-Engineering
**Location**: `apps/sim/hooks/use-collaborative-workspace.ts:17-44`

**Problem**: We have a factory function `createResourceUpdateHandler` that's only used within this one hook.

**Analysis**:
```typescript
// Current: 44 lines for factory + 5 useEffect blocks (each ~15 lines) = ~119 lines

// Alternative: Direct implementation without factory
// Each handler would be ~10 lines inline = ~50 lines total

// Trade-off:
// - Factory: More DRY, but adds abstraction layer
// - Direct: More explicit, easier to understand, less magic
```

**Recommendation**: Keep the factory for now - it's DRY and prevents bugs from inconsistent implementations. However, if we add more parameters or complexity, consider alternatives.

### 6. Massive Hook Files
**Locations**:
- `apps/sim/hooks/use-collaborative-workflow.ts` - **1,609 lines** 😱
- `apps/sim/contexts/socket-context.tsx` - **1,012 lines** 😱

**Problem**: These files are too large to understand or maintain effectively.

**Solution for use-collaborative-workflow.ts**:
```typescript
// Break into smaller composable hooks:
apps/sim/hooks/collaboration/workflow/
  ├── use-workflow-room.ts          // Join/leave room logic
  ├── use-workflow-presence.ts      // Cursor, selection sync
  ├── use-workflow-operations.ts    // Block/edge CRUD
  ├── use-workflow-revert.ts        // Revert handling
  └── index.ts                      // Re-exports or main hook
```

**Solution for socket-context.tsx**:
```typescript
// Option 1: Generate event handlers dynamically
const createEventHandlers = (events: string[]) => {
  return events.reduce((acc, event) => {
    acc[`on${event}`] = (handler) => {
      eventHandlers.current[event] = handler
    }
    return acc
  }, {})
}

// Option 2: Split into multiple contexts
<WorkflowSocketProvider>
  <WorkspaceSocketProvider>
    <PresenceSocketProvider>
      {children}
    </PresenceSocketProvider>
  </WorkspaceSocketProvider>
</WorkflowSocketProvider>
```

### 7. No Organization of Collaborative Hooks
**Location**: `apps/sim/hooks/`

**Problem**: All hooks are in flat structure
```
hooks/
├── use-collaborative-workflow.ts
├── use-collaborative-workspace.ts
├── use-workspace-cleanup.ts
├── use-knowledge.ts
├── ... (20+ other hooks)
```

**Solution**: Group related hooks
```
hooks/
├── collaboration/
│   ├── use-collaborative-workflow.ts
│   ├── use-collaborative-workspace.ts
│   └── use-workspace-cleanup.ts
├── knowledge/
│   ├── use-knowledge.ts
│   └── use-knowledge-base-tag-definitions.ts
├── execution/
│   ├── use-execution-stream.ts
│   └── use-stream-cleanup.ts
└── ... (grouped by domain)
```

---

## 🔵 Low Priority / Nice-to-Have

### 8. Repetitive useEffect Blocks
**Location**: `apps/sim/hooks/use-collaborative-workspace.ts:115-210`

**Problem**: 5 nearly identical useEffect blocks with only minor variations.

**Current**:
```typescript
// Environment variables
useEffect(() => {
  if (!workspaceId) return
  const handleEnvUpdate = createResourceUpdateHandler(...)
  onWorkspaceEnvUpdated(handleEnvUpdate)
}, [dependencies])

// Custom tools
useEffect(() => {
  if (!workspaceId) return
  const handleToolChange = createResourceUpdateHandler(...)
  onWorkspaceToolCreated(handleToolChange)
  onWorkspaceToolUpdated(handleToolChange)
  onWorkspaceToolDeleted(handleToolChange)
}, [dependencies])

// ... 3 more similar blocks
```

**Alternative** (more advanced):
```typescript
const resources = [
  {
    name: 'environment variables',
    fetch: loadWorkspaceEnvironment,
    clear: clearWorkspaceEnvCache,
    events: ['onWorkspaceEnvUpdated'],
  },
  {
    name: 'custom tool',
    fetch: fetchTools,
    events: ['onWorkspaceToolCreated', 'onWorkspaceToolUpdated', 'onWorkspaceToolDeleted'],
  },
  // ...
]

resources.forEach(({ name, fetch, clear, events }) => {
  useEffect(() => {
    if (!workspaceId) return
    const handler = createResourceUpdateHandler(workspaceId, name, fetch, isApplyingRemoteChange, clear)
    events.forEach(event => socket[event](handler))
  }, [workspaceId, ...dependencies])
})
```

**Recommendation**: Keep current implementation - more explicit is better for React hooks. The forEach approach is clever but makes debugging harder.

### 9. Over-Defensive Error Handling
**Location**: `apps/sim/app/workspace/[workspaceId]/providers/workspace-initializer.tsx:204-216`

**Current**:
```typescript
if (criticalFailures.length > 0) {
  const errorMessage =
    criticalFailures.length === criticalResults.length
      ? 'Failed to load all critical workspace data'
      : `Failed to load ${criticalFailures.length} critical workspace resources`

  logger.error(errorMessage, {
    failures: criticalFailures.map((f) => (f.status === 'rejected' ? f.reason : null)),
  })

  throw new Error(errorMessage)
}
```

**Analysis**: The distinction between "all" vs "some" failures doesn't matter - we're throwing either way. The user sees the same result.

**Simplified**:
```typescript
if (criticalFailures.length > 0) {
  throw new Error('Failed to load critical workspace data')
}
```

### 10. Exponential Backoff Implementation
**Location**: `apps/sim/app/workspace/[workspaceId]/providers/workspace-initializer.tsx:250`

**Current**:
```typescript
RETRY_DELAY * (retryAttempt + 1) // 1s, 2s, 3s
```

**Issue**: This is called "exponential backoff" in comments but it's actually **linear backoff**.

**Options**:
```typescript
// Option 1: Keep linear, fix comment
RETRY_DELAY * (retryAttempt + 1) // Linear: 1s, 2s, 3s

// Option 2: Actually do exponential
Math.pow(2, retryAttempt) * RETRY_DELAY // Exponential: 1s, 2s, 4s

// Option 3: Exponential with cap
Math.min(Math.pow(2, retryAttempt) * RETRY_DELAY, 10000) // Max 10s
```

**Recommendation**: Keep linear for workspace initialization - failures are rare and we only retry 3 times.

---

## 📁 Directory Structure Recommendations

### Current Structure (Mixed Concerns)
```
apps/sim/
├── hooks/
│   ├── use-collaborative-workflow.ts (1609 lines!)
│   ├── use-collaborative-workspace.ts
│   ├── use-workspace-cleanup.ts
│   └── ... (20+ other hooks)
├── stores/
│   ├── workflows/
│   ├── knowledge/
│   ├── settings/
│   │   └── environment/
│   └── ...
└── contexts/
    └── socket-context.tsx (1012 lines!)
```

### Recommended Structure (Domain-Driven)
```
apps/sim/
├── features/
│   ├── collaboration/
│   │   ├── hooks/
│   │   │   ├── workspace/
│   │   │   │   ├── use-collaborative-workspace.ts
│   │   │   │   └── use-workspace-cleanup.ts
│   │   │   └── workflow/
│   │   │       ├── use-workflow-room.ts
│   │   │       ├── use-workflow-presence.ts
│   │   │       └── use-workflow-operations.ts
│   │   ├── context/
│   │   │   └── socket-context.tsx (or break this up too)
│   │   └── types.ts
│   ├── workspace/
│   │   ├── hooks/
│   │   │   └── use-workspace-permissions.ts
│   │   ├── providers/
│   │   │   └── workspace-initializer.tsx
│   │   └── stores/
│   └── workflows/
│       └── stores/
│           ├── registry/
│           ├── workflow/
│           └── subblock/
└── shared/
    ├── hooks/
    │   ├── use-debounce.ts
    │   └── use-tag-selection.ts
    └── stores/
        └── providers/
```

**Benefits**:
- Clear feature boundaries
- Related code is co-located
- Easier to understand data flow
- Better for code-splitting

**Migration Path**:
1. Start with new features in new structure
2. Gradually move existing features
3. Use barrel exports (`index.ts`) to maintain backward compatibility

---

## 🎯 Recommended Action Plan

### Phase 1: Quick Wins (1-2 hours)
1. ✅ Fix provider models redundant fetching (#1)
2. ✅ Remove unused return value from useCollaborativeWorkspace (#3)
3. ✅ Update documentation to remove knowledge bases (#4)
4. ✅ Standardize cache clearing signatures (#2)

### Phase 2: Code Quality (4-6 hours)
5. Break up use-collaborative-workflow.ts (#6)
6. Simplify socket-context event handlers (#6)
7. Organize hooks into subdirectories (#7)

### Phase 3: Architectural (8-10 hours)
8. Migrate to feature-based structure (#Directory Structure)
9. Consider splitting socket context into multiple contexts
10. Add integration tests for real-time sync

---

## 🧪 Testing Recommendations

### Current State
- Unit tests for stores ✅
- Unit tests for hooks ✅
- No integration tests for real-time sync ❌

### Recommended Tests
```typescript
// apps/sim/__tests__/integration/realtime-sync.test.ts

describe('Real-time workspace sync', () => {
  it('should sync environment variables across users', async () => {
    const { user1, user2 } = await setupTwoUsers('workspace-123')

    // User 1 creates env var
    await user1.createEnvVar('API_KEY', 'secret')

    // User 2 should see it without refresh
    await waitFor(() => {
      expect(user2.getEnvVars()).toContainEqual({ key: 'API_KEY', value: 'secret' })
    })
  })

  it('should not leak data across workspaces', async () => {
    const user = await setupUser()

    // Load workspace A
    await user.switchToWorkspace('workspace-a')
    const knowledgeBasesA = user.getKnowledgeBases()

    // Load workspace B
    await user.switchToWorkspace('workspace-b')
    const knowledgeBasesB = user.getKnowledgeBases()

    // Should be different
    expect(knowledgeBasesA).not.toEqual(knowledgeBasesB)
  })
})
```

---

## ✅ What's Working Well

1. **Two-phase loading strategy** - Critical vs secondary data is smart
2. **Cache clearing on real-time sync** - Fixed stale data issues
3. **Workspace isolation** - Recent fixes prevent data leakage
4. **Promise.allSettled usage** - Properly handles partial failures
5. **Retry logic** - Graceful handling of transient failures
6. **Unified cleanup hook** - Single source of truth for cleanup
7. **Logger usage** - Excellent observability

---

## 📊 Metrics to Track

After implementing improvements, track:

1. **Workspace Switch Time** - Should decrease by ~20-30% after fixing provider models
2. **Network Requests on Switch** - Should reduce from ~10 to ~7
3. **Cache Hit Rate** - Monitor how often we serve cached vs fresh data
4. **Real-time Sync Latency** - Time from User A's action to User B seeing it
5. **Stale Data Incidents** - Should remain at 0 after fixes

---

## 🔍 Code Review Checklist

When reviewing future changes:

- [ ] Does it fetch data that might already be cached?
- [ ] Are cache clearing functions called before refetch?
- [ ] Are workspace-scoped resources properly isolated?
- [ ] Are socket event handlers properly cleaned up?
- [ ] Are useEffect dependencies complete and minimal?
- [ ] Does the code follow the established factory pattern?
- [ ] Is the hook/store/component in the right directory?
- [ ] Are there integration tests for real-time sync?

---

*Generated: 2025-11-09*
*Reviewed by: Architecture Audit Bot*
