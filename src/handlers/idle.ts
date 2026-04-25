import { Result } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { sendList } from '../services/zapi.js';

export async function showMainMenu(
  userId: string,
  phone: string
): Promise<Result<void, Error>> {
  logger.info({ userId, event: 'show_main_menu' });

  return sendList(phone, 'O que voce quer fazer?', 'Ver opcoes', [
    {
      title: 'Buscar',
      rows: [
        { id: 'discovery', title: 'Olhar em Volta', description: 'Ver quem esta perto' },
        { id: 'bilateral', title: 'Match Perfeito', description: 'Troca exata' },
      ],
    },
    {
      title: 'Gerenciar',
      rows: [
        { id: 'update_listings', title: 'Atualizar Figurinhas' },
        { id: 'update_location', title: 'Atualizar Localizacao' },
      ],
    },
  ]);
}
