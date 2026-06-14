import { useState, useEffect, useRef } from 'react';

export default function CityPicker({ onSelect, current, onCancel }) {
  const [cities, setCities]   = useState([]);
  const [query, setQuery]     = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch('/api/cities')
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(data => { setCities(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });

    // Auto-focus search on mount
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? cities.filter(c =>
        c.label_he?.includes(query) ||
        c.label?.toLowerCase().includes(q) ||
        c.zone_he?.includes(query) ||
        c.zone_en?.toLowerCase().includes(q)
      )
    : cities;

  return (
    <div className="picker">
      <div className="picker-head">
        <div className="picker-title">
          <h1>בחר עיר</h1>
          <p>Choose your city</p>
        </div>
        {onCancel && (
          <button className="btn-icon picker-cancel" onClick={onCancel} aria-label="Cancel">✕</button>
        )}
      </div>

      <input
        ref={inputRef}
        className="picker-search"
        type="search"
        placeholder="חיפוש עיר / Search city…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        dir="auto"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
      />

      {loading && <div className="picker-state">טוען ערים… / Loading cities…</div>}
      {error   && <div className="picker-state error">שגיאה בטעינה / Load error — check connection</div>}

      {!loading && !error && (
        <ul className="picker-list" role="listbox">
          {filtered.length === 0 && (
            <li className="picker-state">לא נמצאו תוצאות / No results</li>
          )}
          {filtered.map(city => (
            <li
              key={city.value}
              className={`picker-item${current?.value === city.value ? ' selected' : ''}`}
              onClick={() => onSelect(city)}
              role="option"
              aria-selected={current?.value === city.value}
            >
              <div className="c-main">
                <span className="c-he">{city.label_he}</span>
                {city.zone_he && <span className="c-zone">{city.zone_he}</span>}
              </div>
              <span className="c-en">{city.label !== city.label_he ? city.label : ''}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="picker-note">
        רשימת הערים מהמערכת הרשמית של פיקוד העורף
        <br />
        Official Pikud HaOref district database
      </p>
    </div>
  );
}
