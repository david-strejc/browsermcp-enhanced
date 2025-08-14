# Browser Hint System - Anti-Bloat Strategy & Improvements

## Executive Summary
This document outlines surgical improvements to prevent database bloat while ensuring Claude saves valuable browser automation patterns after successful goal completions.

## Current System Analysis

### Existing Mechanisms
1. **Hint Storage**: SQLite database with hints table
2. **Deduplication**: SHA1 hash from `domain+path+selector_guard+timestamp` (always unique due to timestamp)
3. **Conflict Resolution**: Higher confidence wins, old hint deactivated
4. **Auto-cleanup**: Deactivates when `failure_count > 10 && confidence < 0.2`
5. **Pruning**: Removes stale hints (90+ days old) with `confidence < 0.3`

### Key Problems Identified
- **Always-unique IDs** prevent true deduplication (timestamp in hash)
- **Weak duplicate detection** only checks exact `selector_guard` match
- **No value assessment** - all patterns treated equally
- **Missing goal context** - saves exploration patterns, not just successful solutions
- **Instruction clarity** - Claude doesn't know when patterns are "worth saving"

## Phase 1: Surgical Improvements (Immediate Implementation)

### 1. Pattern Value Assessment System

Add to `src/hints/core/hint-store.ts`:

```typescript
private assessPatternValue(hint: Partial<BrowserHint>): number {
  const PATTERN_WEIGHTS = {
    'login': 3.0,          // High value - authentication
    'form_fill': 2.5,      // High value - complex forms
    'upload': 2.0,         // Medium-high - file handling
    'search': 1.8,         // Medium-high - search patterns
    'pagination': 1.5,     // Medium - navigation patterns
    'modal': 1.5,          // Medium - important even if simple
    'dynamic': 1.3,        // Medium-low - dynamic content
    'interaction': 1.0,    // Low - basic interactions
    'navigation': 0.8,     // Low - simple navigation
    'wait': 0.5           // Very low - just waiting
  };
  
  const weight = PATTERN_WEIGHTS[hint.pattern_type!] || 1.0;
  const steps = hint.recipe?.length || 0;
  
  // Bonus for complex operations
  const hasComplexSteps = hint.recipe?.some(r => 
    ['browser_wait', 'browser_multitool', 'browser_execute_js'].includes(r.tool)
  );
  
  return weight * (steps + (hasComplexSteps ? 2 : 0));
}
```

**Minimum Threshold**: Only save patterns with value score ≥ 2.5

### 2. Recipe Similarity Detection

Add to `src/hints/tools/save-hint.ts`:

```typescript
private normalizeRecipe(recipe: ToolCall[]): string {
  return recipe.map(r => {
    const action = r.tool.replace('browser_', '');
    // Extract key identifiers from args
    const target = r.args.element || 
                  r.args.selector || 
                  r.args.ref || 
                  r.args.key || 
                  r.args.url || '';
    // Truncate to avoid minor differences
    return `${action}:${target.substring(0, 20)}`;
  }).join('|');
}

private calculateSimilarity(sig1: string, sig2: string): number {
  const parts1 = sig1.split('|');
  const parts2 = sig2.split('|');
  
  if (parts1.length !== parts2.length) {
    return 0;
  }
  
  let matches = 0;
  for (let i = 0; i < parts1.length; i++) {
    if (parts1[i] === parts2[i]) {
      matches++;
    }
  }
  
  return matches / parts1.length;
}
```

### 3. Enhanced Tool Instructions

Update `browser_save_hint` description:

```typescript
description: `Save valuable browser automation patterns for future use. 

WHEN TO SAVE (ALL conditions must be true):
✓ Pattern successfully achieved a user's goal (not just exploration)
✓ Pattern involves 2+ meaningful steps OR handles complex interactions
✓ Pattern type is: login, form_fill, upload, search, pagination, or modal
✓ The pattern would save significant time if encountered again
✓ No similar pattern already exists for this page

WHEN NOT TO SAVE:
✗ Simple single-click actions or basic navigation
✗ Patterns that worked by accident or luck
✗ Site-specific workarounds unlikely to generalize
✗ Exploration or testing patterns without goal completion
✗ Duplicate of existing hint (check with browser_get_hints first)

QUALITY GUIDELINES:
• Be selective - one good hint is worth ten mediocre ones
• Include selector_guard to ensure hint only activates when appropriate
• Write clear descriptions focusing on WHAT the pattern achieves
• Set pattern_type accurately for better matching

IMPORTANT: Only save after successfully completing what the user asked for!`
```

### 4. Goal Achievement Tracking

Add to schema:

```typescript
goal_achieved: {
  type: 'boolean',
  description: 'REQUIRED: Was this pattern used to complete a specific user goal?',
  default: false
},
pattern_value: {
  type: 'number',
  description: 'Optional: Override automatic value calculation (min 2.5 to save)'
}
```

### 5. Confidence Boosting Instead of Duplication

In `save-hint.ts` handle function:

```typescript
// Check for similar patterns
const recipeSignature = this.normalizeRecipe(params.recipe);
const existing = await store.getHints(params.url, 10);
const similarHints = existing.filter(h => {
  const hSig = this.normalizeRecipe(h.recipe);
  return this.calculateSimilarity(recipeSignature, hSig) > 0.8;
});

if (similarHints.length > 0) {
  const best = similarHints[0];
  
  // Boost confidence of existing hint instead of creating duplicate
  await store.updateHintStats(best.id, true);
  const newConfidence = Math.min(1.0, best.confidence + 0.1);
  await store.updateConfidence(best.id, newConfidence);
  
  return {
    status: 'reinforced',
    message: `Existing hint confidence boosted to ${Math.round(newConfidence * 100)}%`,
    hint_id: best.id,
    description: best.description
  };
}
```

### 6. Value Threshold Enforcement

Early in handle function:

```typescript
// Check if goal was achieved
if (!params.goal_achieved) {
  return {
    status: 'skipped',
    reason: 'Hints should only be saved after achieving user goals',
    tip: 'Set goal_achieved: true when you successfully complete what the user asked for'
  };
}

// Assess pattern value
const patternValue = params.pattern_value || store.assessPatternValue(params);
if (patternValue < 2.5) {
  return {
    status: 'skipped',
    reason: 'Pattern too simple to warrant saving',
    value_score: patternValue,
    threshold: 2.5,
    tip: 'Save patterns with multiple steps or handling complex interactions (login, forms, uploads)'
  };
}
```

## Phase 2: Advanced Improvements (Future)

### Semantic Deduplication System
```typescript
// Generate deterministic semantic key (no timestamp)
generateSemanticKey(hint: Partial<BrowserHint>): string {
  const canonical = [
    hint.domain,
    this.canonicalizePathPattern(hint.path_pattern),
    hint.pattern_type,
    this.normalizeRecipe(hint.recipe)
  ].join('::');
  
  return createHash('sha256').update(canonical).digest('hex');
}
```

### Variant Management
- Keep maximum 3 selector variations per semantic pattern
- Store as parent-child relationships
- Auto-promote best performing variant

### Database Schema Updates
```sql
ALTER TABLE hints ADD COLUMN semantic_key TEXT;
ALTER TABLE hints ADD COLUMN recipe_signature TEXT;
ALTER TABLE hints ADD COLUMN pattern_value REAL;
ALTER TABLE hints ADD COLUMN variant_of TEXT;

CREATE INDEX idx_semantic_key ON hints(semantic_key);
CREATE INDEX idx_recipe_signature ON hints(recipe_signature);
```

## Implementation Checklist

### Phase 1 (Immediate)
- [ ] Add `assessPatternValue()` method to HintStore
- [ ] Add `normalizeRecipe()` and `calculateSimilarity()` helpers
- [ ] Update `browser_save_hint` description with clear instructions
- [ ] Add `goal_achieved` field to schema
- [ ] Implement confidence boosting for similar patterns
- [ ] Add value threshold check (min 2.5)
- [ ] Test with various pattern types

### Phase 2 (Future)
- [ ] Implement semantic key generation
- [ ] Add variant management system
- [ ] Update database schema
- [ ] Create migration for existing hints
- [ ] Add compaction worker for variant limits
- [ ] Performance testing with large hint sets

## Expected Outcomes

### Reduction in Database Growth
- **Before**: Every successful pattern saved (100% capture rate)
- **After**: Only valuable patterns saved (~20-30% capture rate)
- **Quality**: Higher average pattern value and reusability

### Pattern Distribution (Estimated)
- Login patterns: 15% (high value, always saved)
- Form fills: 20% (high value, complex patterns)
- Uploads: 10% (medium-high value)
- Search: 15% (medium value, common)
- Modal handling: 10% (medium value, important)
- Navigation: 20% (filtered to complex only)
- Simple clicks: 10% (mostly filtered out)

### Database Size Projections
- Daily new hints: 5-10 (vs 30-50 before)
- Monthly growth: ~200 hints (vs ~1200 before)
- Active hints after pruning: ~500 (vs ~3000 before)

## Testing Strategy

### Test Cases
1. **Simple navigation** → Should be rejected (value < 2.5)
2. **Login flow** → Should be saved (high value pattern)
3. **Duplicate login** → Should boost existing confidence
4. **Complex form** → Should be saved
5. **Single button click** → Should be rejected
6. **Modal dismissal** → Should be saved (if goal achieved)
7. **Multi-step search** → Should be saved

### Metrics to Monitor
- Hint save rate (target: 20-30% of attempts)
- Average pattern value (target: > 3.5)
- Duplicate detection rate (target: > 50% of similar patterns)
- Database growth rate (target: < 10 hints/day)
- Hint reuse success rate (target: > 70%)

## Risk Mitigation

### Potential Issues & Solutions

1. **Over-filtering valuable patterns**
   - Solution: Adjustable thresholds via environment variables
   - Monitoring: Track rejected hints for manual review

2. **Missing edge cases**
   - Solution: Pattern type 'modal' bypasses some filters
   - Special handling for authentication flows

3. **Recipe normalization failures**
   - Solution: Fallback to exact selector comparison
   - Log normalization errors for improvement

4. **Performance degradation**
   - Solution: Indexed semantic_key and recipe_signature
   - Batch similarity checks with early exit

## Conclusion

This strategy balances comprehensive pattern capture with database sustainability through:
1. **Value-based filtering** - Only save patterns worth reusing
2. **Smart deduplication** - Detect functional duplicates
3. **Clear instructions** - Guide Claude's saving behavior
4. **Goal orientation** - Focus on successful completions
5. **Confidence reinforcement** - Strengthen good patterns instead of duplicating

The phased approach allows immediate improvements (Phase 1) while planning for more sophisticated deduplication (Phase 2) without breaking existing functionality.