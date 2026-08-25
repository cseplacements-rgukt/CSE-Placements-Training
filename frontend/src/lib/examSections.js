// Section-aware grouping helpers shared by the exam-taking and results views.
//
// Questions live in one flat array (`exam.questions`) and numbering must stay
// global (1..N in that order) — sections are display buckets only, so
// "Python" might span questions 1-40 and "Machine Learning" 41-80.

/**
 * Group flat question indices by their section.
 *
 * @param {Array} questions  exam.questions (each may carry a sectionId)
 * @param {Array} sections   exam.sections ([{_id, name}])
 * @returns {Array} [{ key, name, indices: number[] }] in section order,
 *   "Ungrouped" last. Returns [] when the exam has no meaningful sectioning
 *   (no sections defined, or every question is ungrouped) so callers can fall
 *   back to a single flat grid.
 */
export function buildSectionGroups(questions, sections) {
  const namedGroups = (Array.isArray(sections) ? sections : []).map((s) => ({
    key: String(s._id),
    name: s.name,
    indices: [],
  }));
  if (namedGroups.length === 0) return [];

  const byId = new Map(namedGroups.map((g) => [g.key, g]));
  const ungrouped = { key: "__ungrouped__", name: "Ungrouped", indices: [] };

  (Array.isArray(questions) ? questions : []).forEach((q, index) => {
    const key = q?.sectionId ? String(q.sectionId) : null;
    ((key && byId.get(key)) || ungrouped).indices.push(index);
  });

  const groups = namedGroups.filter((g) => g.indices.length > 0);
  if (ungrouped.indices.length > 0 && groups.length > 0) {
    groups.push(ungrouped);
  }
  return groups;
}

/** Map of sectionId -> section name for quick lookups while rendering. */
export function sectionNamesById(sections) {
  const map = new Map();
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    map.set(String(s._id), s.name);
  });
  return map;
}
