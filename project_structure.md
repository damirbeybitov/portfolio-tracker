# 📁 portfolio-tracker - Project Structure

*Generated on: 6/15/2026, 12:42:40 PM*

## 📋 Quick Overview

| Metric | Value |
|--------|-------|
| 📄 Total Files | 82 |
| 📁 Total Folders | 34 |
| 🌳 Max Depth | 6 levels |
| 🛠️ Tech Stack | TypeScript, Sass/SCSS, Node.js, Docker |

## ⭐ Important Files

- 🟡 🚫 **.gitignore** - Git ignore rules
- 🟡 🐳 **Dockerfile** - Docker container
- 🟡 🐳 **docker-compose.yml** - Docker compose
- 🟡 🐳 **Dockerfile** - Docker container
- 🟡 🔒 **package-lock.json** - Dependency lock
- 🔴 📦 **package.json** - Package configuration
- 🟡 🔷 **tsconfig.json** - TypeScript config

## 📊 File Statistics

### By File Type

- 📄 **.py** (Other files): 42 files (51.2%)
- 🔷 **.ts** (TypeScript files): 21 files (25.6%)
- ⚙️ **.json** (JSON files): 6 files (7.3%)
- 📖 **.md** (Markdown files): 2 files (2.4%)
- 🐳 **.dockerfile** (Docker files): 2 files (2.4%)
- 📄 **.txt** (Text files): 2 files (2.4%)
- 📄 **.example** (Other files): 1 files (1.2%)
- 🚫 **.gitignore** (Git ignore): 1 files (1.2%)
- 📄 **.mako** (Other files): 1 files (1.2%)
- 📄 **.ini** (Other files): 1 files (1.2%)
- ⚙️ **.yml** (YAML files): 1 files (1.2%)
- 🌐 **.html** (HTML files): 1 files (1.2%)
- 🎨 **.scss** (Sass stylesheets): 1 files (1.2%)

### By Category

- **Other**: 45 files (54.9%)
- **TypeScript**: 21 files (25.6%)
- **Config**: 7 files (8.5%)
- **Docs**: 4 files (4.9%)
- **DevOps**: 3 files (3.7%)
- **Web**: 1 files (1.2%)
- **Styles**: 1 files (1.2%)

### 📁 Largest Directories

- **root**: 82 files
- **backend**: 47 files
- **backend\app**: 41 files
- **frontend**: 32 files
- **frontend\src**: 23 files

## 🌳 Directory Structure

```
portfolio-tracker/
├── 📄 .env.example
├── 🟡 🚫 **.gitignore**
├── 📂 backend/
│   ├── 📂 alembic/
│   │   ├── 📄 env.py
│   │   └── 📄 script.py.mako
│   ├── 📄 alembic.ini
│   ├── 🚀 app/
│   │   ├── 📄 __init__.py
│   │   ├── 🔌 api/
│   │   │   ├── 📄 __init__.py
│   │   │   └── 📂 v1/
│   │   │   │   ├── 📄 __init__.py
│   │   │   │   ├── 📂 endpoints/
│   │   │   │   │   ├── 📄 __init__.py
│   │   │   │   │   ├── 📄 analytics.py
│   │   │   │   │   ├── 📄 auth.py
│   │   │   │   │   ├── 📄 bank.py
│   │   │   │   │   ├── 📄 portfolios.py
│   │   │   │   │   └── 📄 settings.py
│   │   │   │   └── 📄 router.py
│   │   ├── 📂 core/
│   │   │   ├── 📄 __init__.py
│   │   │   ├── 📄 config.py
│   │   │   ├── 📄 logging_config.py
│   │   │   └── 📄 security.py
│   │   ├── 📂 db/
│   │   │   ├── 📄 __init__.py
│   │   │   ├── 📄 base.py
│   │   │   ├── 📄 redis.py
│   │   │   └── 📄 session.py
│   │   ├── 📄 main.py
│   │   ├── 📂 middleware/
│   │   │   ├── 📄 __init__.py
│   │   │   └── 📄 logging.py
│   │   ├── 📂 models/
│   │   │   ├── 📄 __init__.py
│   │   │   ├── 📄 bank.py
│   │   │   ├── 📄 portfolio.py
│   │   │   ├── 📄 transaction.py
│   │   │   ├── 📄 user_settings.py
│   │   │   └── 📄 user.py
│   │   ├── 📂 schemas/
│   │   │   ├── 📄 __init__.py
│   │   │   ├── 📄 analytics.py
│   │   │   ├── 📄 auth.py
│   │   │   ├── 📄 bank.py
│   │   │   ├── 📄 portfolio.py
│   │   │   └── 📄 settings.py
│   │   └── 📂 services/
│   │   │   ├── 📄 __init__.py
│   │   │   ├── 📄 analytics_service.py
│   │   │   ├── 📄 auth_service.py
│   │   │   ├── 📄 bank_service.py
│   │   │   ├── 📄 fx_service.py
│   │   │   ├── 📄 portfolio_service.py
│   │   │   ├── 📄 price_service.py
│   │   │   └── 📄 settings_service.py
│   ├── 📖 BACKEND_README.md
│   ├── 🟡 🐳 **Dockerfile**
│   └── 📄 requirements.txt
├── 🟡 🐳 **docker-compose.yml**
└── 📂 frontend/
│   ├── ⚙️ angular.json
│   ├── 📄 docker-compose-snippet.txt
│   ├── 🟡 🐳 **Dockerfile**
│   ├── 📖 FRONTEND_README.md
│   ├── 🟡 🔒 **package-lock.json**
│   ├── 🔴 📦 **package.json**
│   ├── ⚙️ proxy.conf.json
│   ├── 📁 src/
│   │   ├── 🚀 app/
│   │   │   ├── 🔷 app.component.ts
│   │   │   ├── 🔷 app.config.ts
│   │   │   ├── 🔷 app.routes.ts
│   │   │   ├── 📂 core/
│   │   │   │   ├── 📂 guards/
│   │   │   │   │   └── 🔷 auth.guard.ts
│   │   │   │   ├── 📂 interceptors/
│   │   │   │   │   └── 🔷 auth.interceptor.ts
│   │   │   │   ├── 📂 models/
│   │   │   │   │   └── 🔷 index.ts
│   │   │   │   └── 📂 services/
│   │   │   │   │   ├── 🔷 api.service.ts
│   │   │   │   │   └── 🔷 auth.service.ts
│   │   │   ├── 📂 features/
│   │   │   │   ├── 📂 analytics/
│   │   │   │   │   └── 🔷 analytics.component.ts
│   │   │   │   ├── 📂 auth/
│   │   │   │   │   ├── 🔷 auth.routes.ts
│   │   │   │   │   ├── 📂 login/
│   │   │   │   │   │   └── 🔷 login.component.ts
│   │   │   │   │   └── 📂 register/
│   │   │   │   │   │   └── 🔷 register.component.ts
│   │   │   │   ├── 📂 bank/
│   │   │   │   │   └── 🔷 bank.component.ts
│   │   │   │   ├── 📂 dashboard/
│   │   │   │   │   └── 🔷 dashboard.component.ts
│   │   │   │   ├── 📂 portfolio/
│   │   │   │   │   └── 🔷 portfolio.component.ts
│   │   │   │   ├── 📂 settings/
│   │   │   │   │   └── 🔷 settings.component.ts
│   │   │   │   └── 📂 transactions/
│   │   │   │   │   └── 🔷 transactions.component.ts
│   │   │   └── 📂 shared/
│   │   │   │   └── 🧩 components/
│   │   │   │   │   └── 📂 layout/
│   │   │   │   │   │   └── 🔷 layout.component.ts
│   │   ├── 📂 environments/
│   │   │   ├── 🔷 environment.prod.ts
│   │   │   └── 🔷 environment.ts
│   │   ├── 🌐 index.html
│   │   ├── 🔷 main.ts
│   │   └── 🎨 styles.scss
│   ├── ⚙️ tsconfig.app.json
│   └── 🟡 🔷 **tsconfig.json**
```

## 📖 Legend

### File Types
- 📄 Other: Other files
- 🚫 DevOps: Git ignore
- 📖 Docs: Markdown files
- 🐳 DevOps: Docker files
- 📄 Docs: Text files
- ⚙️ Config: YAML files
- ⚙️ Config: JSON files
- 🔷 TypeScript: TypeScript files
- 🌐 Web: HTML files
- 🎨 Styles: Sass stylesheets

### Importance Levels
- 🔴 Critical: Essential project files
- 🟡 High: Important configuration files
- 🔵 Medium: Helpful but not essential files
