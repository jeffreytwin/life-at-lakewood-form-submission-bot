-- Seed data: sample form submissions with realistic data
-- These give a representative view of what incoming leads look like

INSERT INTO leads (
  location_id, form_name, first_name, last_name, email, phone,
  floor_plan, village, price, home_type, property_address,
  url, builder, timeline, message, routing_status, created_at
)
SELECT
  loc.id,
  v.form_name,
  v.first_name,
  v.last_name,
  v.email,
  v.phone,
  v.floor_plan,
  v.village,
  v.price,
  v.home_type,
  v.property_address,
  v.url,
  v.builder,
  v.timeline,
  v.message,
  v.routing_status,
  v.created_at::timestamptz
FROM (VALUES
  -- 1: Floor Plan inquiry at Lakewood
  ('Life At Lakewood', 'Floor Plan', 'Sarah', 'Mitchell', 'sarah.mitchell@gmail.com', '941-555-0123',
   'The Palermo', 'Summerdale', '$550,000 - $650,000', 'Single Family', NULL,
   'https://www.lifeatmasterplan.com/floor-plans/the-palermo', 'Pulte Homes', 'Within 6 months',
   'We love the open floor plan. Is this available in Summerdale?', 'accepted',
   '2026-03-06 14:23:00-05'),

  -- 2: Lot Availability inquiry at Wellen Park
  ('Life in Wellen Park', 'Lot Availability', 'Michael', 'Torres', 'mtorres82@yahoo.com', '239-555-0456',
   NULL, 'Playmore', '$400,000 - $500,000', 'Single Family', '12405 Playmore Dr',
   'https://www.lifeatmasterplan.com/wellen-park/lots', 'Toll Brothers', 'Within 3 months',
   'Looking for a south-facing lot in Playmore. Preferably on a cul-de-sac.', 'accepted',
   '2026-03-06 10:45:00-05'),

  -- 3: Property Listing inquiry at Lakewood
  ('Life At Lakewood', 'Property Listing', 'Jennifer', 'Nguyen', 'jnguyen.realty@outlook.com', '813-555-0789',
   'The Revere', 'Willowbrook', '$725,000 - $850,000', 'Single Family', '8931 Willowbrook Ln',
   'https://www.lifeatmasterplan.com/listings/8931-willowbrook-ln', 'M/I Homes', NULL,
   NULL, 'routing',
   '2026-03-07 09:12:00-05'),

  -- 4: Contact Us general inquiry at Parrish
  ('Life At Parrish', 'Contact Us', 'David', 'Ramirez', 'david.ramirez@hotmail.com', '727-555-0234',
   NULL, NULL, '$300,000 - $400,000', NULL, NULL,
   NULL, NULL, '6-12 months',
   'My wife and I are relocating from Ohio. We''d like to schedule a tour to see available homes in our budget.', 'pending',
   '2026-03-07 08:30:00-05'),

  -- 5: Floor Plan inquiry at Wellen Park
  ('Life in Wellen Park', 'Floor Plan', 'Amanda', 'Chen', 'amandachen@gmail.com', '941-555-0567',
   'The Catalina', 'Sunstone', '$650,000 - $750,000', 'Single Family', NULL,
   'https://www.lifeatmasterplan.com/floor-plans/the-catalina', 'Mattamy Homes', 'Within 3 months',
   'Can you send me the full spec sheet for the Catalina? Interested in the 4-bed option.', 'accepted',
   '2026-03-05 16:05:00-05'),

  -- 6: Builder Interest at Lakewood
  ('Life At Lakewood', 'Builder Interest', 'Robert', 'Patel', 'rpatel.builds@gmail.com', '863-555-0890',
   NULL, 'Maple Ridge', '$900,000 - $1,100,000', 'Estate', NULL,
   NULL, 'AR Homes', 'Within 12 months',
   'Looking for estate lots with AR Homes. What''s available in Maple Ridge?', 'accepted',
   '2026-03-04 11:30:00-05'),

  -- 7: Realtor Connect at Wellen Park
  ('Life in Wellen Park', 'Realtor Connect', 'Lisa', 'Gonzalez', 'lisa.g@remax.com', '954-555-0345',
   NULL, 'Brightmore', '$500,000 - $600,000', 'Single Family', NULL,
   NULL, 'Pulte Homes', NULL,
   'I have 2 clients interested in Brightmore. Can I get builder pricing and lot availability?', 'accepted',
   '2026-03-05 09:50:00-05'),

  -- 8: Property Listing quick inquiry at Parrish
  ('Life At Parrish', 'Property Listing', 'Kevin', 'O''Brien', 'kobrien77@gmail.com', '941-555-0678',
   'The Ashford', 'Riverbend', '$475,000 - $525,000', 'Single Family', '3217 Riverbend Blvd',
   'https://www.lifeatmasterplan.com/listings/3217-riverbend-blvd', 'Taylor Morrison', 'Within 3 months',
   NULL, 'accepted',
   '2026-03-03 15:20:00-05'),

  -- 9: Contact Us from out of state
  ('Life At Lakewood', 'Contact Us', 'Maria', 'Santos', 'maria.santos@icloud.com', '212-555-0912',
   NULL, NULL, '$1,000,000 - $1,500,000', NULL, NULL,
   NULL, NULL, '3-6 months',
   'Retiring from NYC next year and looking at luxury homes. Would love to schedule a virtual tour first.', 'pending',
   '2026-03-07 07:45:00-05'),

  -- 10: Lot Availability at Lakewood
  ('Life At Lakewood', 'Lot Availability', 'Thomas', 'Williams', 'twilliams.fl@gmail.com', '941-555-0111',
   NULL, 'Heritage Oaks', '$350,000 - $450,000', 'Villa', NULL,
   'https://www.lifeatmasterplan.com/lakewood/lots/heritage-oaks', 'Neal Communities', 'Within 6 months',
   'Interested in villa lots in Heritage Oaks. Do you have any lakefront or preserve-view lots?', 'routing',
   '2026-03-07 10:15:00-05'),

  -- 11: Floor Plan at Parrish
  ('Life At Parrish', 'Floor Plan', 'Stephanie', 'Kim', 'stephanie.kim@protonmail.com', '813-555-0222',
   'The Bellini', 'Cypress Landing', '$380,000 - $430,000', 'Single Family', NULL,
   'https://www.lifeatmasterplan.com/floor-plans/the-bellini', 'Ryan Homes', 'Within 3 months',
   'Does the Bellini come with a 3-car garage option? Also interested in the screened lanai upgrade.', 'accepted',
   '2026-03-02 13:40:00-05'),

  -- 12: Property Listing - already owned by another agent
  ('Life in Wellen Park', 'Property Listing', 'James', 'Foster', 'jfoster.investments@gmail.com', '561-555-0333',
   'The Sanibel', 'Grand Palm', '$1,200,000 - $1,400,000', 'Estate', '15720 Grand Palm Way',
   'https://www.lifeatmasterplan.com/listings/15720-grand-palm-way', 'Stock Development', NULL,
   'Saw this listing on Zillow. Is it still available?', 'owned_by_other',
   '2026-03-01 17:00:00-05')

) AS v(location_name, form_name, first_name, last_name, email, phone,
       floor_plan, village, price, home_type, property_address,
       url, builder, timeline, message, routing_status, created_at)
JOIN locations loc ON loc.name = v.location_name;
