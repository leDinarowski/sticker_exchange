-- Seed: pontos de encontro para área de teste (São Paulo).
--
-- Locais públicos e estabelecimentos comerciais distribuídos por bairros
-- usados nos testes de usuário (Jardins, Pinheiros, Bela Vista, Lapa).
--
-- ST_MakePoint(<longitude>, <latitude>) — longitude primeiro.

SET search_path TO public, extensions;

INSERT INTO meeting_places (name, address, neighborhood, location)
VALUES
  ('Livraria da Vila',
   'Al. Lorena, 1731',
   'Jardins',
   ST_SetSRID(ST_MakePoint(-46.6614, -23.5672), 4326)),

  ('Cafe Martins',
   'Av. Reboucas, 1381',
   'Pinheiros',
   ST_SetSRID(ST_MakePoint(-46.6825, -23.5619), 4326)),

  ('Parque Trianon',
   'Av. Paulista, 1351',
   'Bela Vista',
   ST_SetSRID(ST_MakePoint(-46.6560, -23.5590), 4326)),

  ('Shopping Iguatemi',
   'Av. Brig. Faria Lima, 2232',
   'Jardim Paulistano',
   ST_SetSRID(ST_MakePoint(-46.6870, -23.5744), 4326)),

  ('Mercado da Lapa',
   'R. Guaicurus, 1205',
   'Lapa',
   ST_SetSRID(ST_MakePoint(-46.7055, -23.5258), 4326));
