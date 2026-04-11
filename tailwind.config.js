/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6',
        secondary: '#6366F1',
        accent: '#10B981',
        dark: '#1F2937',
        darker: '#111827'
      }
    },
  },
  plugins: [],
}
