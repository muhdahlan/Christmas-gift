# Christmas Gift 🎁



![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Platform: Base](https://img.shields.io/badge/Platform-Base-blue) ![Farcaster: Frame](https://img.shields.io/badge/Farcaster-Frame-purple)



A festive, blockchain-enabled Farcaster Frame application built on Base, designed to deliver a delightful and interactive holiday gifting experience directly within the Farcaster feed.



---## Overview**Christmas Gift** is a purpose-built Farcaster Frame that leverages the speed and cost-efficiency of the Base L2 network. It provides a seamless and engaging user journey, taking users from an interactive Frame in their social feed to a full-featured, holiday-themed web application.### Key Features* **Farcaster Frame Integration:**    * **Interactive Feed Entry:** Users are greeted with a visually appealing gift box Frame within their Farcaster feed.    * **One-Click Launch:** A simple "Open Gift 🎁" button action seamlessly transitions the user to the main web application.    * **Optimized Metadata:** Full compliance with the Farcaster Frame specification (v1), ensuring correct rendering and interaction across clients.* **Base L2 Integration:**    * **Builder Code Association:** All onchain activities originating from the app are automatically attributed using a dedicated Base Builder Code (`bc_m1xia1u3`), preparing the project for future ecosystem rewards and analytics.    * **Base App Compatibility:** The application is fully configured with required metadata (`primaryCategory`, `tags`) for discoverability and correct functioning within the Base App directory.* **Modern Tech Stack:**    * **Frontend:** Built with React (via Vite) for a performant and responsive user interface.    * **Styling:** Utilizes Tailwind CSS for rapid, utility-first styling, ensuring a consistent and polished design across devices.    * **Hosting:** Deployed on Vercel for reliable, global serverless hosting and continuous deployment.



---## Getting Started



These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.### Prerequisites* **Node.js**: Version 18.x or higher is recommended.* **npm** or **yarn**: Package manager for installing dependencies.### Installation1.  **Clone the repository:**    ```bash

    git clone [https://github.com/username/christmas-gift.git](https://github.com/username/christmas-gift.git)

    cd christmas-gift

    ```2.  **Install dependencies:**    ```bash

    npm install

    # or

    yarn install

    ```3.  **Start the development server:**    ```bash

    npm run dev

    # or

    yarn dev

    ```

    The application will be available at `http://localhost:5173`.

---## Project Structure



The project adheres to a standard React & Vite directory structure, optimized for clarity and scalability.

christmas-gift/

├── public/             # Static assets (images, icons, favicons)

├── src/                # Source code

│   ├── components/     # Reusable React components

│   ├── App.tsx         # Main application component

│   ├── main.tsx        # Application entry point

│   └── index.css       # Global CSS and Tailwind directives

├── farcaster.json      # Base App metadata configuration

├── index.html          # HTML entry point with Frame meta tags

├── package.json        # Project dependencies and scripts

├── tailwind.config.js  # Tailwind CSS configuration

└── vite.config.ts      # Vite configuration



---



## Configuration Details



### Farcaster Frame



The Frame configuration is embedded directly within the `<head>` of `index.html` using standard `<meta>` tags. This ensures immediate recognition by Farcaster clients.



```html

<meta name="fc:frame" content='{

  "version": "1",

  "imageUrl": "[https://your-deployed-url.com/og-image.png](https://your-deployed-url.com/og-image.png)",

  "button": {

    "title": "Open Gift 🎁",

    "action": {

      "type": "launch_frame",

      "name": "Christmas Gift",

      "url": "[https://your-deployed-url.com](https://your-deployed-url.com)",

      "splashImageUrl": "[https://your-deployed-url.com/splash.png](https://your-deployed-url.com/splash.png)",

      "splashBackgroundColor": "#8b0000"

    }

  }

}' />

Base App Metadata

To ensure proper listing and discoverability within the Base App ecosystem, a dedicated farcaster.json file is placed at the project root.

JSON



// farcaster.json

{

  "primaryCategory": "entertainment",

  "tags": [

    "christmas",

    "crypto",

    "gift",

    "airdrop",

    "holiday"

  ]

}

Deployment

The project is optimized for deployment on Vercel.

Push your code to a Git repository (GitHub, GitLab, etc.).

Import the project into Vercel.

Vercel will automatically detect the Vite framework and configure the build settings.

Deploy. Your application, including the Farcaster Frame, will be live globally.

License

This project is licensed under the MIT License - see the LICENSE file for details.
