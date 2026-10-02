-- A gRPC API test carries the .proto that describes its service (server/api-protocols.ts).
ALTER TABLE "api_tests" ADD COLUMN IF NOT EXISTS "proto_definition" text;
