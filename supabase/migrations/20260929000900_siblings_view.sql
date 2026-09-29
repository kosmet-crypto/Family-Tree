-- Roots & Branches — siblings view: "half" only when a different second parent is known.
-- Two people sharing their only known parent are full siblings until someone enters otherwise.

create or replace view public.person_siblings
with (security_invoker = true) as
with pairs as (
  select
    a.tree_id,
    a.child_id as person_id,
    b.child_id as sibling_id,
    count(*) filter (where a.relation = 'biological' and b.relation = 'biological') as shared_biological_parents,
    count(*) as shared_parents,
    bool_or(a.relation = 'adoptive' or b.relation = 'adoptive') as any_adoptive
  from public.parent_child a
  join public.parent_child b on b.parent_id = a.parent_id and b.child_id <> a.child_id
  group by a.tree_id, a.child_id, b.child_id
)
select
  p.tree_id,
  p.person_id,
  p.sibling_id,
  p.shared_biological_parents,
  p.shared_parents,
  case
    when p.shared_biological_parents >= 2 then 'full'
    when p.shared_biological_parents = 1 and exists (
      -- one of them has a biological parent the other does not have
      select 1 from public.parent_child x
       where x.relation = 'biological'
         and ((x.child_id = p.person_id and not exists (
                 select 1 from public.parent_child y where y.child_id = p.sibling_id and y.parent_id = x.parent_id and y.relation = 'biological'))
           or (x.child_id = p.sibling_id and not exists (
                 select 1 from public.parent_child y where y.child_id = p.person_id and y.parent_id = x.parent_id and y.relation = 'biological')))
    ) then 'half'
    when p.shared_biological_parents = 1 then 'full'
    when p.any_adoptive then 'adoptive'
    else 'step'
  end as sibling_type
from pairs p;
