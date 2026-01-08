import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    // Perbaikan untuk private_key agar tidak error di serverless environment
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_URL,
    });
    console.log("Firebase Admin Initialized");
  } catch (error) {
    console.error("Firebase Admin Error:", error.message);
  }
}

export const db = admin.database();