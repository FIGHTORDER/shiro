import React from "react";
import { mapCatalogue, normaliseMapName } from "../net/zkcatalogue.ts";

/**
 * What Zero-K knows about a map, once the catalogue has loaded.
 *
 * `undefined` until then, and for any map the catalogue does not list - a brand
 * new or unlisted one. That is a real answer and callers must render it as one:
 * the featured catalogue is not every map anybody plays.
 *
 * The catalogue is fetched once per session and memoised, so this is a lookup
 * rather than a request.
 */
export function useMapInfo(map) {
  const [info, setInfo] = React.useState(undefined);
  React.useEffect(() => {
    if (!map) { setInfo(undefined); return undefined; }
    let live = true;
    mapCatalogue().then(
      c => { if (live) setInfo(c.get(normaliseMapName(map))); },
      () => {},                       // offline just means links stay searches
    );
    return () => { live = false; };
  }, [map]);
  return info;
}

/**
 * Just the zero-k.info ResourceID, which is what `MapImage` wants for its link.
 *
 * Kept as its own hook because that is all three of its callers need, and a
 * screen that only draws a minimap should not have to know the record exists.
 */
export function useMapResourceId(map) {
  return useMapInfo(map)?.resourceId;
}
