'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SendIcon from '@mui/icons-material/Send';
import { colors } from '../theme';

const faqItems = [
  {
    question: 'Como funciona o leilão de imóveis da Caixa?',
    answer:
      'Os leilões de imóveis da Caixa Econômica Federal são realizados para venda de imóveis retomados. Você pode participar fazendo lances online durante o período de licitação. Os imóveis podem ser adquiridos com recursos próprios, FGTS ou financiamento.',
  },
  {
    question: 'Quais são os planos disponíveis?',
    answer:
      'Oferecemos o plano Gratuito com acesso básico à busca, o plano Standard com acesso a favoritos, lembretes e filtros salvos, e o plano Premium com todos os recursos incluindo busca por IA e alertas prioritários.',
  },
  {
    question: 'Como configuro lembretes para leilões?',
    answer:
      'Acesse a página de detalhes do imóvel desejado e clique em "Criar Lembrete". Você pode escolher ser notificado por email. É necessário ter o plano Standard ou superior.',
  },
  {
    question: 'Como funciona a busca por IA?',
    answer:
      'Nossa busca inteligente permite que você descreva o imóvel desejado em linguagem natural. Por exemplo: "apartamento 2 quartos em São Paulo até 200 mil". O sistema interpreta sua busca e encontra os melhores resultados.',
  },
  {
    question: 'Posso cancelar minha assinatura a qualquer momento?',
    answer:
      'Sim, você pode cancelar sua assinatura a qualquer momento através da página de Perfil. O acesso aos recursos premium continuará até o fim do período já pago.',
  },
  {
    question: 'Como entro em contato com o suporte?',
    answer:
      'Você pode enviar uma solicitação através do formulário abaixo. Nossa equipe responderá no email cadastrado em sua conta.',
  },
];

export default function SupportPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const token = document.cookie
        .split('; ')
        .find((row) => row.startsWith('token='))
        ?.split('=')[1];

      const response = await fetch('/api/support', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erro ao enviar solicitação');
      }

      setSnackbar({
        open: true,
        message: 'Solicitação de suporte enviada com sucesso!',
        severity: 'success',
      });
      setTitle('');
      setDescription('');
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: error.message || 'Erro ao enviar solicitação de suporte.',
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Suporte
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Encontre respostas para as perguntas mais frequentes ou envie uma solicitação para nossa equipe.
        </Typography>
      </Box>

      {/* FAQ Section */}
      <Box sx={{ mb: 5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <HelpOutlineIcon sx={{ color: colors.red }} />
          <Typography variant="h6" fontWeight={600}>
            Perguntas frequentes
          </Typography>
        </Box>

        {faqItems.map((item, index) => (
          <Accordion
            key={index}
            sx={{
              '&:before': { display: 'none' },
              boxShadow: 'none',
              border: '1px solid',
              borderColor: 'divider',
              mb: 1,
              borderRadius: '8px !important',
              '&:first-of-type': { borderRadius: '8px !important' },
              '&:last-of-type': { borderRadius: '8px !important' },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={500}>{item.question}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography color="text.secondary">{item.answer}</Typography>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      {/* Support Form */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <SendIcon sx={{ color: colors.red }} />
          <Typography variant="h6" fontWeight={600}>
            Enviar solicitação
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Descreva seu problema ou dúvida e nossa equipe entrará em contato pelo email da sua conta.
        </Typography>

        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            inputProps={{ minLength: 3, maxLength: 200 }}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Descrição"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            required
            multiline
            rows={4}
            inputProps={{ minLength: 10, maxLength: 2000 }}
            sx={{ mb: 3 }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !title.trim() || !description.trim()}
            startIcon={loading ? <CircularProgress size={18} /> : <SendIcon />}
          >
            {loading ? 'Enviando...' : 'Enviar solicitação'}
          </Button>
        </Box>
      </Paper>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
