# 237 Ville Community Platform

237 Ville is a Node/Postgres web application for member communication, voting, events, dues, donations, member questions, and admin publishing.

## Features

- Member registration and email-based login.
- Automatic default admin bootstrap from `.env` on migration/server start.
- Forced password update for the default admin and approved members with temporary passwords.
- Admin validation workflow for new registrations, including application statements and uploaded ID cards.
- Admin rejection workflow for registrations that do not pass validation.
- Temporary password generation in the admin approval screen.
- Admin cleanup for old notifications.
- Member onboarding with policy acknowledgement and registration fee review.
- Member profiles with contact details and notification preferences.
- Announcements and articles published by admins.
- In-app notifications when announcements are published.
- Event calendar entries managed by admins.
- Member questions with admin approval before public discussion.
- Public comments on published member questions.
- Issue votes and executive board elections with aggregate results only in the UI.
- Dues and donation records for members, with admin payment review.
- Admin tools for members, announcements, events, questions, ballots, and payments.

## Local setup

1. Create the Postgres database if it does not already exist:

   ```bash
   createdb organization_237
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Run the schema migration:

   ```bash
   npm run migrate
   ```

5. Optionally seed or refresh the default admin account:

   ```bash
   npm run seed
   ```

   The server also checks this admin account at startup. Default login:

   - Email: `admin@237ville.org`
   - Password: `ChangeMe237!`

6. Start the app:

   ```bash
   npm start
   ```

   Then open `http://localhost:4173`.

## Voting privacy note

The database stores a voter identifier so each member can vote only once per ballot. The member-facing and admin-facing UI intentionally shows only aggregate vote totals and never lists which member voted for a candidate or issue option.

## Payments note

The app currently records dues, donations, and registration fee payment records for admin review. A payment processor such as Stripe, PayPal, or a local mobile money provider can be added later for live card or mobile payments.

## Member onboarding flow

1. A visitor registers with first name, last name, email, an application statement, and an ID card upload.
2. Admins receive an in-app notification and validate the application and ID card.
3. Admins approve the account with a temporary password or reject the registration with a reason.
4. The member logs in with the temporary password and must set a private password.
5. The member signs the organization policy.
6. The member submits a registration fee record.
7. An admin marks the registration fee received, which activates the member portal account.
