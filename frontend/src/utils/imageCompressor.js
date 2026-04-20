import imageCompression from 'browser-image-compression';

// Comprime l'image
export const compressImage = async (file, options = {}) => {
  const {
    maxSizeMB = 1,
    maxWidthOrHeight = 1200,
  } = options;

  console.log(`Compression de l'image: ${file.name}, Taille originale: ${(file.size / 1024 / 1024).toFixed(2)} Mo`);

  try {
    const options = {
      maxSizeMB,
      maxWidthOrHeight,
      useWebWorker: true,
      fileType: 'image/webp',
      initialQuality: 0.8,
      maxIteration: 10,
    };

    const compressedFile = await imageCompression(file, options);
    
    console.log(`Image compressée: ${compressedFile.name}, Taille: ${(compressedFile.size / 1024).toFixed(2)} Ko`);
    
    // Créer un nouveau fichier avec l'extension .webp
    const newFile = new File(
      [compressedFile],
      `${file.name.split('.')[0]}.webp`,
      { type: 'image/webp' }
    );
    
    return newFile;
  } catch (error) {
    console.error('Erreur lors de la compression de l\'image:', error);
    return file;
  }
};

// Vérifie si le fichier est une image
export const isImage = (file) => {
  return file && file.type.startsWith('image/');
};

// Vérifie si l'image doit être compressée
export const shouldCompress = (file, maxSizeMB = 2) => {
  return file.size > maxSizeMB * 1024 * 1024;
};