-- The bot acknowledges ordinary saves with a reaction instead of a reply, so undoing such a report
-- has to clear that reaction. The web app never calls Telegram itself: it enqueues this kind and
-- the worker performs it.
ALTER TYPE "OutboxKind" ADD VALUE 'REACTION';
