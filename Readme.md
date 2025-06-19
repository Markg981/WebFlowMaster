# WebTest Platform - Readme.md

## Overview

This is a full-stack web application for creating and executing automated tests on web pages. The platform integrates Playwright for browser automation and element detection, providing users with a visual interface to create test sequences by interacting with web elements.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for client-side routing
- **Build Tool**: Vite with hot module replacement

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Authentication**: Passport.js with local strategy and session-based auth
- **Database ORM**: Drizzle ORM
- **Session Storage**: PostgreSQL-backed sessions via connect-pg-simple

### Database Schema
- **Users**: Authentication and user management
- **Tests**: Test configurations with sequences and detected elements
- **Test Runs**: Execution history and results tracking
- **Relationships**: Users have many tests, tests have many runs

## Key Components

### Authentication System
- Session-based authentication using express-session
- Password hashing with Node.js crypto (scrypt)
- Protected routes with authentication middleware
- User registration and login endpoints

### Test Management
- Visual test creation interface
- URL loading through backend proxy (CORS handling)
- Element detection using mock implementation (placeholder for Omniparser V2)
- Drag-and-drop test sequence builder
- Test execution and result tracking

### Database Layer
- PostgreSQL with Neon serverless driver
- Drizzle ORM for type-safe database operations
- Migration system for schema changes
- Connection pooling for performance

## Data Flow

1. **Authentication Flow**: User logs in → Session created → JWT-like session management
2. **Test Creation Flow**: URL input → Backend proxy load → Element detection → Visual test builder
3. **Test Execution Flow**: Test trigger → Backend execution → Results storage → UI updates
4. **Data Persistence**: All operations go through Drizzle ORM → PostgreSQL database

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: Database connectivity
- **drizzle-orm**: Database ORM and query builder
- **passport**: Authentication middleware
- **express-session**: Session management
- **@tanstack/react-query**: Server state management

### UI Dependencies
- **@radix-ui/***: Headless UI components
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library
- **wouter**: Lightweight router

### Development Dependencies
- **tsx**: TypeScript execution for development
- **esbuild**: Fast JavaScript bundler for production
- **vite**: Frontend build tool and dev server

## Deployment Strategy

### Development Environment
- **Runtime**: Node.js 20 with PostgreSQL 16
- **Development Server**: `npm run dev` runs both frontend (Vite) and backend (tsx)
- **Hot Reload**: Vite HMR for frontend, tsx watch mode for backend
- **Port Configuration**: Backend on 5000, proxied through Vite

### Production Deployment
- **Build Process**: `npm run build` - Vite build + esbuild bundle
- **Runtime**: `npm run start` serves production bundle
- **Platform**: Configured for Replit autoscale deployment
- **Database**: Environment variable DATABASE_URL for connection

### Logging Configuration
- `LOG_RETENTION_DAYS`: Specifies the number of days to retain log files. Old log files will be compressed and stored. If not set, the default retention period is 7 days.
  - Example: `LOG_RETENTION_DAYS=14`

### Database Management
- **Migrations**: `npm run db:push` applies schema changes
- **Schema Location**: `./shared/schema.ts` for type sharing
- **Configuration**: `drizzle.config.ts` for migration settings

## Changelog

```
Changelog:
- June 13, 2025. Initial setup
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```

## Development Notes

### Folder Structure
- `client/`: React frontend application
- `server/`: Express.js backend application  
- `shared/`: Common TypeScript types and database schema
- `migrations/`: Database migration files (generated)

### Key Configuration Files
- `vite.config.ts`: Frontend build configuration
- `drizzle.config.ts`: Database migration configuration
- `tsconfig.json`: TypeScript compiler settings
- `tailwind.config.ts`: Styling configuration

### Environment Setup
- Requires `DATABASE_URL` environment variable
- Optional `SESSION_SECRET` for secure sessions
- Development mode supports Replit-specific tooling

### Planned Integrations
- **Playwright**: For web page automation and element detection
- **Omniparser V2**: For DOM element analysis and classification
- **Docker**: For containerized deployment (configured but not implemented)

The application follows a monorepo structure with shared TypeScript types between frontend and backend, enabling full-stack type safety and efficient development workflows.
