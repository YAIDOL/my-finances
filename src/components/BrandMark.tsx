/** A folded M: a small, single-colour mark independent of font rendering. */
export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 256 256" focusable="false"><path fill="currentColor" d="M40 208V48H72L128 104L184 48H216V208H184V96L128 152L72 96V208Z"/></svg>
  </span>;
}
