
-- Replace the safety-net inventory flush cron so it targets the new
-- flush endpoint with the correct anon-key auth. Idempotent.
DO $$
DECLARE
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91YmJxZmlzanRvZnptY2Nkb2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMjYyMjQsImV4cCI6MjA5NzYwMjIyNH0.cukKciPHsgbbFlnhDqvh5QlSACa1AFZj7HuYg1QZbtM';
  flush_url text := 'https://project--54c2d0ec-24bc-4ff6-b063-403855dbdef4.lovable.app/api/public/inventory/flush-refresh-queue';
BEGIN
  PERFORM cron.unschedule('inventory-refresh-queue-flush')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inventory-refresh-queue-flush');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'inventory-refresh-queue-flush',
  '* * * * *',
  format(
    $cmd$SELECT net.http_post(
      url := %L,
      headers := %L::jsonb,
      body := '{}'::jsonb
    );$cmd$,
    'https://project--54c2d0ec-24bc-4ff6-b063-403855dbdef4.lovable.app/api/public/inventory/flush-refresh-queue',
    '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91YmJxZmlzanRvZnptY2Nkb2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMjYyMjQsImV4cCI6MjA5NzYwMjIyNH0.cukKciPHsgbbFlnhDqvh5QlSACa1AFZj7HuYg1QZbtM"}'
  )
);
