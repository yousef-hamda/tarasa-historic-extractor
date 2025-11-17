/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        tarasa: {
          50: '#f5f8ff',
          100: '#e0ebff',
          500: '#2a66f2',
          600: '#1b4ed8',
        },
      },
    },
  },
  plugins: [],
};