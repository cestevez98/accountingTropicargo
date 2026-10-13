/** Barra de filtros por GET (sin JavaScript): conserva los parámetros en la URL. */
export function Filtros({ base, valores, campos }: { base: string; valores: Record<string, string | undefined>; campos: { nombre: string; label: string; tipo?: 'text' | 'date' | 'select'; opciones?: { valor: string; label: string }[]; ancho?: string }[] }) {
  return (
    <form action={base} className="tarjeta mb-4 flex flex-wrap items-end gap-2 p-3">
      {campos.map((c) => (
        <label key={c.nombre} className={c.ancho ?? 'w-40'}>
          <span className="etiqueta">{c.label}</span>
          {c.tipo === 'select' ? (
            <select name={c.nombre} defaultValue={valores[c.nombre] ?? ''} className="input">
              <option value="">Todos</option>
              {c.opciones?.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input name={c.nombre} type={c.tipo ?? 'text'} defaultValue={valores[c.nombre] ?? ''} className="input" />
          )}
        </label>
      ))}
      {Object.entries(valores)
        .filter(([k, v]) => v && !campos.some((c) => c.nombre === k) && k !== 'p')
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <button className="btn btn-primario">Filtrar</button>
      <a href={base} className="btn">
        Limpiar
      </a>
    </form>
  )
}
