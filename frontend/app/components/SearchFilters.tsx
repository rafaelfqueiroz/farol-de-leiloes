'use client';

import { useState } from 'react';
import {
  Box,
  Drawer,
  TextField,
  MenuItem,
  Button,
  Typography,
  Slider,
  Checkbox,
  FormControlLabel,
  FormGroup,
  IconButton,
  Divider,
  Autocomplete,
  CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import FilterListIcon from '@mui/icons-material/FilterList';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

interface SearchFiltersProps {
  onSearch: (filters: AuctionFilters) => void;
  onAISearchResults?: (results: { total: number; items: any[] }) => void;
  isLoading?: boolean;
  initialFilters?: AuctionFilters;
}

export interface AuctionFilters {
  state?: string;
  city?: string[];
  neighborhood?: string;
  modality?: string[];
  minMargin?: number;
  maxMargin?: number;
}

const BRAZILIAN_STATES = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
];

const MODALITIES = [
  { value: 'SFI_AUCTION', label: 'Leilão SFI' },
  { value: 'OPEN_BIDDING', label: 'Licitação Aberta' },
  { value: 'DIRECT_ONLINE_SALES', label: 'Venda Direta Online' },
  { value: 'ONLINE_SALES', label: 'Venda Online' },
];

// Brazilian cities organized by state (major cities)
const CITIES_BY_STATE: Record<string, string[]> = {
  'AC': ['Rio Branco', 'Cruzeiro do Sul', 'Sena Madureira', 'Tarauacá', 'Feijó'],
  'AL': ['Maceió', 'Arapiraca', 'Palmeira dos Índios', 'Rio Largo', 'Penedo'],
  'AP': ['Macapá', 'Santana', 'Laranjal do Jari', 'Oiapoque', 'Mazagão'],
  'AM': ['Manaus', 'Parintins', 'Itacoatiara', 'Manacapuru', 'Coari'],
  'BA': ['Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Camaçari', 'Itabuna', 'Juazeiro', 'Lauro de Freitas', 'Ilhéus', 'Jequié', 'Teixeira de Freitas'],
  'CE': ['Fortaleza', 'Caucaia', 'Juazeiro do Norte', 'Maracanaú', 'Sobral', 'Crato', 'Itapipoca', 'Maranguape', 'Iguatu', 'Quixadá'],
  'DF': ['Brasília', 'Taguatinga', 'Ceilândia', 'Samambaia', 'Planaltina'],
  'ES': ['Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Cachoeiro de Itapemirim', 'Linhares', 'Colatina', 'Guarapari', 'São Mateus', 'Aracruz'],
  'GO': ['Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Rio Verde', 'Luziânia', 'Águas Lindas de Goiás', 'Valparaíso de Goiás', 'Trindade', 'Formosa', 'Novo Gama'],
  'MA': ['São Luís', 'Imperatriz', 'São José de Ribamar', 'Timon', 'Caxias', 'Codó', 'Paço do Lumiar', 'Açailândia', 'Bacabal', 'Balsas'],
  'MT': ['Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop', 'Tangará da Serra', 'Cáceres', 'Sorriso', 'Lucas do Rio Verde', 'Barra do Garças', 'Primavera do Leste'],
  'MS': ['Campo Grande', 'Dourados', 'Três Lagoas', 'Corumbá', 'Ponta Porã', 'Sidrolândia', 'Aquidauana', 'Naviraí', 'Nova Andradina', 'Paranaíba'],
  'MG': ['Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora', 'Betim', 'Montes Claros', 'Ribeirão das Neves', 'Uberaba', 'Governador Valadares', 'Ipatinga', 'Sete Lagoas', 'Divinópolis', 'Santa Luzia', 'Ibirité', 'Poços de Caldas'],
  'PA': ['Belém', 'Ananindeua', 'Santarém', 'Marabá', 'Castanhal', 'Parauapebas', 'Itaituba', 'Cametá', 'Bragança', 'Abaetetuba'],
  'PB': ['João Pessoa', 'Campina Grande', 'Santa Rita', 'Patos', 'Bayeux', 'Sousa', 'Cajazeiras', 'Guarabira', 'Mamanguape', 'Cabedelo'],
  'PR': ['Curitiba', 'Londrina', 'Maringá', 'Ponta Grossa', 'Cascavel', 'São José dos Pinhais', 'Foz do Iguaçu', 'Colombo', 'Guarapuava', 'Paranaguá', 'Araucária', 'Toledo', 'Apucarana', 'Pinhais', 'Campo Largo'],
  'PE': ['Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Caruaru', 'Petrolina', 'Paulista', 'Cabo de Santo Agostinho', 'Camaragibe', 'Garanhuns', 'Vitória de Santo Antão'],
  'PI': ['Teresina', 'Parnaíba', 'Picos', 'Piripiri', 'Floriano', 'Campo Maior', 'Barras', 'Altos', 'Esperantina', 'Pedro II'],
  'RJ': ['Rio de Janeiro', 'São Gonçalo', 'Duque de Caxias', 'Nova Iguaçu', 'Niterói', 'Belford Roxo', 'Campos dos Goytacazes', 'São João de Meriti', 'Petrópolis', 'Volta Redonda', 'Magé', 'Itaboraí', 'Mesquita', 'Nova Friburgo', 'Macaé'],
  'RN': ['Natal', 'Mossoró', 'Parnamirim', 'São Gonçalo do Amarante', 'Macaíba', 'Ceará-Mirim', 'Caicó', 'Assu', 'Currais Novos', 'Touros'],
  'RS': ['Porto Alegre', 'Caxias do Sul', 'Pelotas', 'Canoas', 'Santa Maria', 'Gravataí', 'Viamão', 'Novo Hamburgo', 'São Leopoldo', 'Rio Grande', 'Alvorada', 'Passo Fundo', 'Sapucaia do Sul', 'Uruguaiana', 'Santa Cruz do Sul'],
  'RO': ['Porto Velho', 'Ji-Paraná', 'Ariquemes', 'Vilhena', 'Cacoal', 'Jaru', 'Rolim de Moura', 'Guajará-Mirim', 'Pimenta Bueno', 'Espigão do Oeste'],
  'RR': ['Boa Vista', 'Rorainópolis', 'Caracaraí', 'Mucajaí', 'São João da Baliza'],
  'SC': ['Florianópolis', 'Joinville', 'Blumenau', 'São José', 'Criciúma', 'Chapecó', 'Itajaí', 'Jaraguá do Sul', 'Lages', 'Palhoça', 'Balneário Camboriú', 'Brusque', 'Tubarão', 'São Bento do Sul', 'Caçador'],
  'SP': ['São Paulo', 'Guarulhos', 'Campinas', 'São Bernardo do Campo', 'Santo André', 'Osasco', 'São José dos Campos', 'Ribeirão Preto', 'Sorocaba', 'Mauá', 'São José do Rio Preto', 'Santos', 'Diadema', 'Carapicuíba', 'Piracicaba', 'Bauru', 'Itaquaquecetuba', 'Mogi das Cruzes', 'Jundiaí', 'Franca'],
  'SE': ['Aracaju', 'Nossa Senhora do Socorro', 'Lagarto', 'Itabaiana', 'Estância', 'São Cristóvão', 'Simão Dias', 'Propriá', 'Tobias Barreto', 'Laranjeiras'],
  'TO': ['Palmas', 'Araguaína', 'Gurupi', 'Porto Nacional', 'Paraíso do Tocantins', 'Colinas do Tocantins', 'Guaraí', 'Miracema do Tocantins', 'Formoso do Araguaia', 'Tocantinópolis'],
};

const PRICE_MARKS = [
  { value: 0, label: 'R$ 0' },
  { value: 500000, label: 'R$ 500k' },
  { value: 1000000, label: 'R$ 1M' },
  { value: 2000000, label: 'R$ 2M' },
];

const DRAWER_WIDTH = 380;

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `R$ ${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `R$ ${(value / 1000).toFixed(0)}k`;
  }
  return `R$ ${value}`;
}

export default function SearchFilters({ onSearch, onAISearchResults, isLoading = false, initialFilters = {} }: SearchFiltersProps) {
  const [filters, setFilters] = useState<AuctionFilters>(initialFilters);
  const [priceRange, setPriceRange] = useState<number[]>([
    initialFilters.minMargin || 0,
    initialFilters.maxMargin || 2000000
  ]);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [aiSearchInput, setAiSearchInput] = useState('');
  const [aiSearchLoading, setAiSearchLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      ...filters,
      minMargin: priceRange[0] > 0 ? priceRange[0] : undefined,
      maxMargin: priceRange[1] < 2000000 ? priceRange[1] : undefined,
    });
  };

  const handleReset = () => {
    setFilters({});
    setPriceRange([0, 2000000]);
  };

  const handleCityChange = (_: any, newValue: string[]) => {
    setFilters({
      ...filters,
      city: newValue.length > 0 ? newValue : undefined,
    });
  };

  const handleModalityChange = (modality: string) => {
    const currentModalities = filters.modality || [];
    const newModalities = currentModalities.includes(modality)
      ? currentModalities.filter(m => m !== modality)
      : [...currentModalities, modality];
    setFilters({
      ...filters,
      modality: newModalities.length > 0 ? newModalities : undefined,
    });
  };

  const handlePriceChange = (_: Event, newValue: number | number[]) => {
    setPriceRange(newValue as number[]);
  };

  // Get available cities based on selected state
  const getAvailableCities = (): string[] => {
    if (!filters.state) {
      // If no state selected, show all cities from all states
      return Object.values(CITIES_BY_STATE).flat().sort();
    }
    // Return cities for selected state, sorted alphabetically
    return (CITIES_BY_STATE[filters.state] || []).sort();
  };

  const handleStateChange = (newState: string) => {
    setFilters({
      ...filters,
      state: newState || undefined,
      // Clear city selections when state changes
      city: undefined
    });
  };

  const handleAISearch = async () => {
    if (!aiSearchInput.trim() || !onAISearchResults) return;

    setAiSearchLoading(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: aiSearchInput })
      });

      if (!response.ok) {
        throw new Error('Falha na busca por IA');
      }

      const results = await response.json();
      onAISearchResults(results);
    } catch (error) {
      console.error('Erro na busca por IA:', error);
    } finally {
      setAiSearchLoading(false);
    }
  };

  return (
    <>
      {/* Center Content - AI Search */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          Busque por IA
        </Typography>
        <TextField
          fullWidth
          value={aiSearchInput}
          onChange={(e) => setAiSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAISearch()}
          placeholder="Ex: apartamento em santos até 300 mil"
          disabled={aiSearchLoading}
          slotProps={{
            input: {
              endAdornment: (
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={aiSearchLoading ? <CircularProgress size={20} color="inherit" /> : <SearchIcon />}
                  onClick={handleAISearch}
                  disabled={aiSearchLoading || !aiSearchInput.trim()}
                  sx={{ ml: 1 }}
                >
                  {aiSearchLoading ? 'Buscando...' : 'Buscar'}
                </Button>
              ),
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              pr: 1,
            },
          }}
        />
      </Box>

      {/* Toggle Button for Filter Panel */}
      {!drawerOpen && (
        <IconButton
          onClick={() => setDrawerOpen(true)}
          sx={{
            position: 'fixed',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            backgroundColor: 'primary.main',
            color: 'white',
            borderRadius: '8px 0 0 8px',
            '&:hover': {
              backgroundColor: 'primary.dark',
            },
            zIndex: 1200,
            px: 1,
            py: 2,
          }}
        >
          <FilterListIcon />
        </IconButton>
      )}

      {/* Right Panel - Filters */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        variant="persistent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            mt: '64px', // TopBar height
            height: 'calc(100vh - 64px)',
            borderLeft: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Header */}
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" fontWeight={600}>
              Filtros de Busca
            </Typography>
            <IconButton size="small" onClick={() => setDrawerOpen(false)}>
              <ChevronRightIcon />
            </IconButton>
          </Box>

          {/* Scrollable Content */}
          <Box component="form" onSubmit={handleSubmit} sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
            {/* Location Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="primary.main" sx={{ mb: 2, fontWeight: 600 }}>
                Localização
              </Typography>

              <TextField
                select
                fullWidth
                label="Estado"
                value={filters.state || ''}
                onChange={(e) => handleStateChange(e.target.value)}
                size="small"
                sx={{ mb: 2 }}
              >
                <MenuItem value="">Todos os estados</MenuItem>
                {BRAZILIAN_STATES.map((state) => (
                  <MenuItem key={state.code} value={state.code}>
                    {state.name}
                  </MenuItem>
                ))}
              </TextField>

              <Autocomplete
                multiple
                options={getAvailableCities()}
                value={filters.city || []}
                onChange={handleCityChange}
                disableCloseOnSelect
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Cidade"
                    placeholder={filters.city && filters.city.length > 0 ? "" : "Digite para buscar cidade..."}
                    size="small"
                  />
                )}
                renderOption={(props, option, { selected }) => {
                  const { key, ...otherProps } = props;
                  return (
                    <li key={key} {...otherProps}>
                      <Checkbox
                        checked={selected}
                        size="small"
                        sx={{ mr: 1 }}
                      />
                      {option}
                    </li>
                  );
                }}
                sx={{ mb: 2 }}
                noOptionsText="Nenhuma cidade encontrada"
                ListboxProps={{
                  style: { maxHeight: 250 }
                }}
              />

              <TextField
                fullWidth
                label="Bairro"
                value={filters.neighborhood || ''}
                onChange={(e) => setFilters({ ...filters, neighborhood: e.target.value || undefined })}
                placeholder="Digite o nome do bairro"
                size="small"
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Modality Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="primary.main" sx={{ mb: 2, fontWeight: 600 }}>
                Modalidade do Leilão
              </Typography>

              <Box sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                backgroundColor: 'background.paper'
              }}>
                <FormGroup>
                  {MODALITIES.map((modality) => (
                    <FormControlLabel
                      key={modality.value}
                      control={
                        <Checkbox
                          checked={filters.modality?.includes(modality.value) || false}
                          onChange={() => handleModalityChange(modality.value)}
                          size="small"
                        />
                      }
                      label={<Typography variant="body2">{modality.label}</Typography>}
                    />
                  ))}
                </FormGroup>
              </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Price Range Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="primary.main" sx={{ mb: 2, fontWeight: 600 }}>
                Preço
              </Typography>

              <Box sx={{ px: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Faixa de preço
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {formatCurrency(priceRange[0])} - {formatCurrency(priceRange[1])}
                  </Typography>
                </Box>
                <Slider
                  value={priceRange}
                  onChange={handlePriceChange}
                  valueLabelDisplay="auto"
                  valueLabelFormat={formatCurrency}
                  min={0}
                  max={2000000}
                  step={50000}
                  marks={PRICE_MARKS}
                  sx={{
                    '& .MuiSlider-markLabel': {
                      fontSize: '0.65rem',
                    },
                  }}
                />
              </Box>
            </Box>
          </Box>

          {/* Fixed Action Buttons */}
          <Box sx={{
            p: 2,
            borderTop: 1,
            borderColor: 'divider',
            backgroundColor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              startIcon={<SearchIcon />}
              disabled={isLoading}
              onClick={handleSubmit}
            >
              {isLoading ? 'Buscando...' : 'Buscar Imóveis'}
            </Button>
            <Button
              type="button"
              variant="outlined"
              fullWidth
              startIcon={<ClearIcon />}
              onClick={handleReset}
              disabled={isLoading}
            >
              Limpar Filtros
            </Button>
          </Box>
        </Box>
      </Drawer>
    </>
  );
}
