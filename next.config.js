/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  redirects: async () => {
    return [
      {
        source: "/github",
        destination: "https://github.com/The-UnknownHacker/GhostNotes",
        permanent: true,
      },
      {
        source: "/feedback",
        destination: "https://github.com/The-UnknownHacker/GhostNotes/issues",
        permanent: true,
      }
    ];
  },
};

module.exports = nextConfig;
