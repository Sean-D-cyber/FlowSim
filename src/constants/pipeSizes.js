// Nominal pipe size table (Schedule 40 steel pipe, the common default for
// process/utility piping). Internal diameter in mm and m. Users can still
// type a custom diameter; this table just drives a convenient picker.

export const NOMINAL_PIPE_SIZES = [
  { nps: '1/2"', dnMm: 15, idMm: 15.8 },
  { nps: '3/4"', dnMm: 20, idMm: 20.9 },
  { nps: '1"', dnMm: 25, idMm: 26.6 },
  { nps: '1-1/4"', dnMm: 32, idMm: 35.1 },
  { nps: '1-1/2"', dnMm: 40, idMm: 40.9 },
  { nps: '2"', dnMm: 50, idMm: 52.5 },
  { nps: '2-1/2"', dnMm: 65, idMm: 62.7 },
  { nps: '3"', dnMm: 80, idMm: 77.9 },
  { nps: '4"', dnMm: 100, idMm: 102.3 },
  { nps: '5"', dnMm: 125, idMm: 128.2 },
  { nps: '6"', dnMm: 150, idMm: 154.1 },
  { nps: '8"', dnMm: 200, idMm: 202.7 },
  { nps: '10"', dnMm: 250, idMm: 254.5 },
  { nps: '12"', dnMm: 300, idMm: 303.2 },
];

export function nominalIdMeters(nps) {
  const row = NOMINAL_PIPE_SIZES.find((r) => r.nps === nps);
  return row ? row.idMm / 1000 : undefined;
}
