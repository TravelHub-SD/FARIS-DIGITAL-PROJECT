-- The only way an order's status changes through the API.
-- Transition rules live in the orders BEFORE UPDATE trigger, so they hold for
-- every path; this function adds the permission check and the customer note.

create function public.change_order_status(
  p_order_id uuid,
  p_to_status text,
  p_customer_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not private.has_permission('orders') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_customer_note is not null and char_length(p_customer_note) > 500 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;

  perform set_config('app.status_note', coalesce(p_customer_note, ''), true);
  update public.orders set status = p_to_status where id = p_order_id
  returning * into v_order;
  perform set_config('app.status_note', '', true);

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_order;
end;
$$;

revoke execute on function public.change_order_status(uuid, text, text) from public, anon;
grant execute on function public.change_order_status(uuid, text, text) to authenticated;
