// The documentation site (Astro Starlight): plain Markdown pages in src/content/docs, built to static files.
// Published to GitHub Pages at https://kushalr3ddy.github.io/whatsapp-crm/ by .github/workflows/docs-site.yml.
// `site` and `base` must match that address, or links and images break.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://kushalr3ddy.github.io',
  base: '/whatsapp-crm',
  integrations: [
    starlight({
      title: 'WhatsApp CRM',
      description: 'A shared WhatsApp inbox, bulk campaigns and an AI assistant, with ban protection built in. Setup guides and how-tos.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Kushalr3ddy/whatsapp-crm' }],
      editLink: { baseUrl: 'https://github.com/Kushalr3ddy/whatsapp-crm/edit/main/site/' },
      customCss: ['./src/styles/custom.css'],
      lastUpdated: true,
      sidebar: [
        { label: 'Start here', items: [
          { label: 'What this is', slug: 'start/what-is-it' },
          { label: 'Sign in and find your way', slug: 'start/sign-in' },
          { label: 'Overview page', slug: 'start/overview' }
        ] },
        { label: 'Setup', items: [
          { label: 'Install with Docker', slug: 'setup/install' },
          { label: 'Settings (environment variables)', slug: 'setup/environment' },
          { label: 'Link a WhatsApp number', slug: 'setup/link-a-number' },
          { label: 'Choose the AI model', slug: 'setup/ai-model' }
        ] },
        { label: 'Use it', items: [
          { label: 'Import contacts', slug: 'guides/import' },
          { label: 'Contacts', slug: 'guides/contacts' },
          { label: 'Inbox', slug: 'guides/inbox' },
          { label: 'Campaigns', slug: 'guides/campaigns' },
          { label: 'The AI assistant', slug: 'guides/ai-assistant' },
          { label: 'Team and roles', slug: 'guides/team' },
          { label: 'Security: encryption keys', slug: 'guides/security' }
        ] },
        { label: 'How it protects your numbers', items: [
          { label: 'Safety rules in plain words', slug: 'concepts/safety' },
          { label: 'Warm-up and sending pace', slug: 'concepts/warm-up' },
          { label: '"Waiting for this message"', slug: 'concepts/waiting-for-this-message' }
        ] },
        { label: 'API', items: [
          { label: 'Overview and sign-in', slug: 'api/overview' },
          { label: 'Endpoint reference', slug: 'api/endpoints' }
        ] },
        { label: 'Help', items: [
          { label: 'Troubleshooting and FAQ', slug: 'help/troubleshooting' },
          { label: 'Glossary', slug: 'help/glossary' }
        ] }
      ]
    })
  ]
});
