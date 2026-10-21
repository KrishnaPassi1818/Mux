import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/client';

export const useHealth = () => useQuery({
  queryKey: ['health'],
  queryFn: getHealth,
  refetchInterval: 10_000,
  retry: 1,
  staleTime: 3_000,
});
