import { useId } from 'react'
import exhibitCss from './house-exhibit.css'

/** A decorative architectural assembly, independent of project data. */
export function HouseExhibit() {
  const id = useId()
  const paint = (name: string) => `url(#${id}-${name})`

  return (
    <div className="ih-house-exhibit" aria-hidden="true">
      <style>{exhibitCss}</style>
      <svg viewBox="0 0 460 250" fill="none" focusable="false">
        <defs>
          <linearGradient id={`${id}-stone`} x1="104" y1="64" x2="340" y2="178" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d9e1d6" /><stop offset=".45" stopColor="#9aa99b" /><stop offset="1" stopColor="#506157" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="110" y1="99" x2="278" y2="194" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d1e9de" stopOpacity=".65" /><stop offset=".4" stopColor="#638e80" stopOpacity=".18" /><stop offset="1" stopColor="#192c27" stopOpacity=".8" />
          </linearGradient>
          <linearGradient id={`${id}-side`} x1="259" y1="104" x2="356" y2="171" gradientUnits="userSpaceOnUse">
            <stop stopColor="#87948a" /><stop offset="1" stopColor="#293f36" />
          </linearGradient>
          <linearGradient id={`${id}-metal`} x1="110" y1="111" x2="335" y2="198" gradientUnits="userSpaceOnUse">
            <stop stopColor="#e9eee4" /><stop offset=".28" stopColor="#74877a" /><stop offset=".67" stopColor="#c5d1c0" /><stop offset="1" stopColor="#495e50" />
          </linearGradient>
          <linearGradient id={`${id}-beam`}>
            <stop stopColor="#c4e4d0" stopOpacity="0" /><stop offset=".5" stopColor="#efffdc" /><stop offset="1" stopColor="#b0dbc3" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="#a6cbb4" stopOpacity=".14" /><stop offset="1" stopColor="#6fa68b" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="240" cy="145" rx="205" ry="110" fill={paint('halo')} />
        <g className="ih-house-orbit" stroke="#8aa391" strokeWidth=".65" opacity=".25">
          <ellipse cx="234" cy="199" rx="189" ry="36" />
          <path d="m34 199 200 46 190-46-190-46Z" strokeDasharray="3 8" />
          <path d="M234 153v-8m0 108v-9M34 199H22m402 0h12" />
        </g>

        <g className="ih-house-platform">
          <path d="m80 163 133-59 160 72-131 61Z" fill="#15241e" opacity=".8" />
          <path d="m80 155 133-59 160 72-131 61Z" fill="#45584a" stroke="#8c9d89" strokeWidth=".7" />
          <path d="m80 155 162 74v8L80 163Z" fill="#26372e" />
          <path d="m242 229 131-61v8l-131 61Z" fill="#1d3027" />
          <path d="m92 155 121-53 147 66-118 55Z" fill="#5b6c58" stroke="#82947c" strokeWidth=".4" />
          <path d="m105 157 108-48 135 60-106 48Z" stroke="#a9b69c" strokeWidth=".6" opacity=".65" />
          <path d="m263 209 68-31m-62 34 68-31m-62 34 68-31" stroke="#b7c4ae" strokeWidth="2" opacity=".5" />
        </g>

        <g className="ih-house-room">
          {/* Interior floor and the rear concrete wall. */}
          <path d="m121 145 90-42 123 56-91 42Z" fill="#b6b59b" />
          <path d="m121 145 90-42V60l-90 42Z" fill="#647466" />
          <path d="m211 60 123 56v43l-123-56Z" fill={paint('side')} />
          <path d="m224 75 97 44v29l-97-44Z" fill="#223b30" />
          <path d="m228 81 87 39v20l-87-39Z" fill="#d7bc7c" opacity=".55" />
          <path d="m248 90 0 19m22-9v19m22-9v19" stroke="#7c8a71" strokeWidth="3" />
          {/* Furnishing gives the glass volume a readable domestic scale. */}
          <path d="m190 126 39-18 64 29-40 19Z" fill="#8b9a7a" />
          <path d="m190 126 63 30v9l-63-30Z" fill="#697a5b" />
          <path d="m253 156 40-19v9l-40 19Z" fill="#50684f" />
          <path d="m200 119 29-13 55 25-10 5-45-20-19 9Z" fill="#cad0b2" />
          <path d="m200 119 10 6v10l-10-5Z" fill="#a9b397" />
          <ellipse cx="210" cy="160" rx="20" ry="8" fill="#213c2e" />
          <path d="M195 160v9m29-9v8" stroke="#324c38" strokeWidth="2" />
          <ellipse cx="210" cy="157" rx="20" ry="8" fill="#d5d2b5" />
          <path d="m209 153 9 4-7 3-8-4Z" fill="#7f8f72" />
          {/* Continuous glazed front. */}
          <path d="m121 102 122 56v43l-122-56Z" fill={paint('glass')} stroke="#ccdfcd" strokeWidth=".7" />
          <path d="m243 158 91-42v43l-91 42Z" fill={paint('glass')} stroke="#bad1bd" strokeWidth=".7" />
          <path d="M150 115v44m31-30v44m31-29v44m31-30v43m30-57v43m31-58v43" stroke="#bbceba" strokeWidth="1.6" />
          <path d="m128 108 15 7 32 52-15-7Zm48 22 8 4 31 51-8-4Z" fill="#e9f8e7" opacity=".12" />
          <path d="m121 145 122 56 91-42" stroke="#e1d5a1" strokeWidth="1.5" opacity=".8" />
        </g>

        <g className="ih-house-roof">
          <path d="m109 96 103-47 134 61-103 48Z" fill={paint('stone')} stroke="#bfcdbb" strokeWidth=".7" />
          <path d="m109 96 134 62v8l-134-62Z" fill={paint('metal')} />
          <path d="m243 158 103-48v8l-103 48Z" fill="#5a7060" />
          <path d="m125 95 87-39 117 54-86 40Z" stroke="#d5dfcb" strokeWidth=".7" opacity=".55" />
          <path d="m143 96 69-31 100 46-68 32Z" fill="#66806b" opacity=".5" />
          <path d="m163 96 48-22 79 36-47 22Z" fill="#243c2e" stroke="#a1b89c" strokeWidth=".7" />
          <path d="m171 96 40-18 71 33-39 18Z" fill="#75977d" opacity=".6" />
          <path d="m211 78 0 31m-20-22 71 33m-52-41 71 33" stroke="#afc5a4" strokeWidth=".6" opacity=".65" />
          <path className="ih-house-light" d="m110 104 133 62 103-48" stroke={paint('beam')} strokeWidth="2.1" pathLength="100" />
        </g>

        <g className="ih-house-rays" stroke="#bed2ae" strokeWidth=".65" strokeDasharray="2 5" opacity=".3">
          <path d="M109 90V74m134 78v-18m103-30V88" />
        </g>
        <circle className="ih-house-beacon" cx="345" cy="191" r="2" fill="#d7deaa" />
      </svg>
    </div>
  )
}
