/** Data/ora in italiano (fuso Europe/Rome). */
export function formatDataIt(d: Date): string {
  return d.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Tempo trascorso dall'istante di ricezione del messaggio all'elaborazione (worker).
 * Etichetta richiesta: "tempo da invio mail" = delta ricezione → ora di processing.
 */
export function formatTempoDaInvioMail(ms: number): string {
  let x = ms;
  if (x < 0) x = 0;
  const min = Math.floor(x / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${h} h ${mm} min`;
}
