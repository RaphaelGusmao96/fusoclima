# Fuso Horario e Clima

Ferramenta web para comparar fusos horarios e clima em tempo real de mais de 20 cidades ao redor do mundo.

**Demo:** https://fusohorarioeclima.vercel.app/

---

## Sobre

O **Fuso Horario e Clima** e uma aplicacao web que combina conversao de fusos horarios com dados meteorologicos em tempo real. Ideal para profissionais que coordenam reunioes internacionais, viajantes e equipes remotas distribuidas globalmente.

## Funcionalidades

- Comparacao de horario entre 20+ cidades pre-configuradas
- Clima em tempo real via API do OpenWeatherMap (temperatura, umidade, vento, condicao)
- Previsao de minimas e maximas para hoje e amanha
- Conversor de horario interativo com slider de 24 horas
- Deteccao automatica de localizacao do usuario via geolocation
- Sincronizacao de estado via URL (compartilhavel)
- Temas visuais: aurora (azul gelo), nebula (dourado) e padrao
- Modos de exibicao: automatico (segue o OS), dia e noite
- Atualizacao automatica dos dados a cada 5 minutos
- Design glassmorphism responsivo (desktop, tablet e mobile)

## Cidades disponiveis

**Americas:** Sao Paulo, Rio de Janeiro, New York, Los Angeles, Toronto, Buenos Aires, Santiago, Mexico City

**Europa:** Londres, Paris, Lisboa, Madrid, Berlim, Moscou

**Asia-Pacifico:** Toquio, Seul, Mumbai, Dubai, Sydney, Cairo

## Stack

- **Frontend:** HTML5, CSS3, JavaScript puro (sem frameworks)
- **API:** OpenWeatherMap (clima atual + previsao de 5 dias)
- **Servidor local:** Node.js (server.js, porta 3000)
- **Deploy:** Vercel

## Rodar localmente

**Pre-requisito:** Node.js instalado.

```bash
git clone https://github.com/Alien96/fusoclima.git
cd fusoclima
node server.js
```

Acesse `http://localhost:3000` no navegador.

> A chave de API do OpenWeatherMap ja esta configurada no `app.js` para uso em desenvolvimento.

## Estrutura do projeto

```
fusoclima/
├── index.html        # Pagina principal (comparador de fusos e clima)
├── app.js            # Logica da aplicacao, integracao com API, gerenciamento de estado
├── styles.css        # Estilos (glassmorphism, temas, responsividade)
├── server.js         # Servidor HTTP simples para desenvolvimento local
├── guia.html         # Guia de uso
├── faq.html          # Perguntas frequentes
├── sobre.html        # Sobre o projeto
├── privacidade.html  # Politica de privacidade
├── termos.html       # Termos de uso
├── contato.html      # Contato
├── sitemap.xml       # Sitemap para SEO
└── robots.txt        # Configuracao para crawlers
```

## Contato

r.gusmao.dev@gmail.com
