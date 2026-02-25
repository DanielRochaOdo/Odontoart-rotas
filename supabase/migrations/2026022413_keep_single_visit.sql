-- Remove sample visits so only one remains
delete from public.agenda
where cod_1 in ('B015','C210','D111','E207','F502','G808','H330','I909');
