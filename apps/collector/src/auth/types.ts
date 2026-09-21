/**
 * A collector as the DEVICE knows one: the six keys `sync_pull` sends, no more.
 *
 * Never the auth.users email -- that belongs to a shared GoTrue instance (parent spec
 * §12.1) and the pull deliberately does not send it.
 */
export interface Collector {
  id: string;
  employee_no: string | null;
  full_name: string | null;
  pin_hash: string | null;
  status: string | null;
}
