import type { AgendaRow } from "../types/agenda";

const toTimestamp = (value: string | null | undefined) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

/**
 * Ordem padrão da lista de empresas da Agenda:
 * empresas com rota futura, nunca visitadas, última visita mais antiga e id.
 */
export const compareAgendaRowsByDefaultOrder = (left: AgendaRow, right: AgendaRow) => {
  const leftHasUpcomingRoute = Boolean(left.has_upcoming_route);
  const rightHasUpcomingRoute = Boolean(right.has_upcoming_route);
  if (leftHasUpcomingRoute !== rightHasUpcomingRoute) {
    return leftHasUpcomingRoute ? -1 : 1;
  }

  const leftWasNeverVisited = !left.data_da_ultima_visita;
  const rightWasNeverVisited = !right.data_da_ultima_visita;
  if (leftWasNeverVisited !== rightWasNeverVisited) {
    return leftWasNeverVisited ? -1 : 1;
  }

  const leftLastVisit = toTimestamp(left.data_da_ultima_visita);
  const rightLastVisit = toTimestamp(right.data_da_ultima_visita);
  if (leftLastVisit !== rightLastVisit) {
    if (leftLastVisit === null) return 1;
    if (rightLastVisit === null) return -1;
    return leftLastVisit - rightLastVisit;
  }

  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
};
