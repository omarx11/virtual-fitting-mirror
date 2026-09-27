/**
 * Whether this build is served together with the local AI server (server/).
 *
 * `npm run build:static` (used for Vercel, see vercel.json) builds with `--mode static`: a static
 * site with no /api behind it. AI mode then explains that it runs only on the in-store kiosk and
 * never calls the API. Every other build (`npm run dev`, `npm run build` + `npm start`) has the server.
 */
export const AI_BACKEND_DEPLOYED = import.meta.env.MODE !== 'static';
