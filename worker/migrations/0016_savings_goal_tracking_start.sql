-- Category-linked savings goals used to count the ENTIRE history of the linked
-- category as progress, which instantly overfilled a goal linked to a category with
-- past spending. Add a per-goal tracking start date: category progress counts only
-- transactions dated on/after this day. Defaults to the goal's creation date, and the
-- user can move it earlier to include prior history they've been tracking.
ALTER TABLE savings_goals ADD COLUMN tracking_start_date TEXT;
