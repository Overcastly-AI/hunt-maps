/**
 * The recursive predicate tree editor.
 *
 * `GroupNode` renders one `all`/`any` group and its children; `ConditionRow`
 * wraps a single child and owns negation (wrapping/unwrapping a `not`) in one
 * place, so `BACKLOG R56`'s warning renders from exactly one code path
 * regardless of where in the tree a negation appears; `LeafOrGroupNode`
 * dispatches a non-negated value to the right leaf editor or recurses into a
 * nested `GroupNode`.
 */

import { Button, Callout } from '@hunt-maps/design';
import type { GroupPredicate, TerrainPredicate } from '@hunt-maps/terrain';
import { AspectNode, BenchNode, RangeNode, WeissNode, WoodNode } from './PredicateLeafEditors';
import { defaultPredicateForKind, emptyGroup, isGroup, MAX_PREDICATE_DEPTH } from './predicateUtils';

export interface PredicateNodeProps {
  value: GroupPredicate;
  onChange: (next: GroupPredicate) => void;
  windFromDeg: number | null;
  depth: number;
}

const ADDABLE: Array<{ kind: 'range' | 'aspect' | 'weiss' | 'wood' | 'bench'; label: string }> = [
  { kind: 'range', label: '+ Terrain value' },
  { kind: 'aspect', label: '+ Facing' },
  { kind: 'weiss', label: '+ Landform' },
  { kind: 'wood', label: '+ Feature' },
  { kind: 'bench', label: '+ Bench' },
];

export function GroupNode({ value, onChange, windFromDeg, depth }: PredicateNodeProps) {
  function setMode(mode: 'all' | 'any') {
    onChange({ ...value, kind: mode });
  }

  function updateChild(index: number, next: TerrainPredicate) {
    const operands = [...value.operands];
    operands[index] = next;
    onChange({ ...value, operands });
  }

  function removeChild(index: number) {
    onChange({ ...value, operands: value.operands.filter((_, i) => i !== index) });
  }

  function addChild(predicate: TerrainPredicate) {
    onChange({ ...value, operands: [...value.operands, predicate] });
  }

  const canNest = depth < MAX_PREDICATE_DEPTH - 1;

  return (
    <div className="rl-filter-group" data-depth={depth}>
      <div className="rl-filter-segmented rl-filter-group__mode" role="group" aria-label="Match">
        <button
          type="button"
          className={value.kind === 'all' ? 'rl-btn rl-btn--primary' : 'rl-btn rl-btn--ghost'}
          aria-pressed={value.kind === 'all'}
          onClick={() => setMode('all')}
        >
          Match ALL of
        </button>
        <button
          type="button"
          className={value.kind === 'any' ? 'rl-btn rl-btn--primary' : 'rl-btn rl-btn--ghost'}
          aria-pressed={value.kind === 'any'}
          onClick={() => setMode('any')}
        >
          Match ANY of
        </button>
      </div>

      {value.operands.length === 0 && (
        <p className="rl-hint">
          {depth === 0
            ? 'Add at least one condition below — an empty filter has nothing to match.'
            : 'This group is empty — add a condition or remove the group.'}
        </p>
      )}

      <ul className="rl-filter-group__list">
        {value.operands.map((child, i) => (
          <li key={i}>
            <ConditionRow
              value={child}
              onChange={(next) => updateChild(i, next)}
              onRemove={() => removeChild(i)}
              windFromDeg={windFromDeg}
              depth={depth + 1}
            />
          </li>
        ))}
      </ul>

      <div className="rl-filter-add-row">
        {ADDABLE.map((a) => (
          <Button key={a.kind} variant="ghost" onClick={() => addChild(defaultPredicateForKind(a.kind))}>
            {a.label}
          </Button>
        ))}
        {canNest && (
          <Button variant="ghost" onClick={() => addChild(emptyGroup('all'))}>
            + Group
          </Button>
        )}
      </div>
    </div>
  );
}

function ConditionRow({
  value,
  onChange,
  onRemove,
  windFromDeg,
  depth,
}: {
  value: TerrainPredicate;
  onChange: (next: TerrainPredicate) => void;
  onRemove: () => void;
  windFromDeg: number | null;
  depth: number;
}) {
  const negated = value.kind === 'not';
  const inner = negated ? value.operand : value;

  function setNegated(next: boolean) {
    onChange(next ? { kind: 'not', operand: inner } : inner);
  }

  function changeInner(next: TerrainPredicate) {
    onChange(negated ? { kind: 'not', operand: next } : next);
  }

  return (
    <div className={negated ? 'rl-filter-row rl-filter-row--negated' : 'rl-filter-row'}>
      <div className="rl-filter-row__head">
        <label className="rl-filter-row__negate">
          <input type="checkbox" checked={negated} onChange={(e) => setNegated(e.target.checked)} />
          <span>Not</span>
        </label>
        <Button variant="danger" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {negated && (
        // BACKLOG R56, stated plainly where it is being built, not in a
        // tooltip: `evaluateFilter` reads a void/no-data cell as `false` for
        // every ordinary predicate, and `not` flips that `false` to `true` —
        // this exact checkbox paints a confident band along the edge of
        // whatever ground has no elevation data. The real fix is tri-state
        // evaluation in the engine (a separate, larger change); until that
        // ships, the honest thing this editor can do is say so every time.
        <Callout tone="warn" role="status">
          <p>
            <strong>Negating a condition is unreliable at the edge of your downloaded ground.</strong>{' '}
            Cells with no elevation data cannot be evaluated, and a "Not" condition currently reads
            an unmeasurable cell as a match — so this will paint a band along the boundary of
            whatever terrain you have not downloaded, not a real feature. The live match share below
            is hidden for any filter with a "Not" in it, for the same reason.
          </p>
        </Callout>
      )}

      <LeafOrGroupNode value={inner} onChange={changeInner} windFromDeg={windFromDeg} depth={depth} />
    </div>
  );
}

function LeafOrGroupNode({
  value,
  onChange,
  windFromDeg,
  depth,
}: {
  value: TerrainPredicate;
  onChange: (next: TerrainPredicate) => void;
  windFromDeg: number | null;
  depth: number;
}) {
  if (isGroup(value)) {
    return <GroupNode value={value} onChange={onChange} windFromDeg={windFromDeg} depth={depth} />;
  }
  switch (value.kind) {
    case 'range':
      return <RangeNode value={value} onChange={onChange} windFromDeg={windFromDeg} />;
    case 'aspect':
      return <AspectNode value={value} onChange={onChange} />;
    case 'weiss':
      return <WeissNode value={value} onChange={onChange} />;
    case 'wood':
      return <WoodNode value={value} onChange={onChange} />;
    case 'bench':
      return <BenchNode value={value} onChange={onChange} />;
    default:
      return null;
  }
}
