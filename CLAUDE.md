# FairFares Development Framework

**Project**: FairFares - Ride-sharing & Travel Platform  
**Current Status**: ~50% developed with core UI/UX foundation  
**Development Model**: Agile Sprints with Multi-Agent Team

---

## 🎯 Project Vision

Build a **user-friendly, mobile-optimized** travel platform featuring:
- Ride-sharing explorer with gamification
- Admin dashboard for bookings, users, discounts, commercials
- Email marketing & feedback systems
- Responsive design (mobile-first)
- Real-time features & smooth interactions

---

## 👥 Team Structure & Roles

### 1. **Scrum Master** 🎯
- Sprint planning & daily standups
- Removes blockers, tracks velocity
- Manages sprint burndown & retrospectives
- Ensures team stays aligned

### 2. **Product Manager** 📋
- Clarifies requirements & user stories
- Prioritizes backlog based on business value
- Owns user experience vision
- Validates acceptance criteria

### 3. **Tech Lead / Senior Developer** 🏗️
- Architecture & technical decisions
- Code quality & performance standards
- Reviews all PRs before merge
- Identifies technical debt

### 4. **Developer(s)** 💻
- Feature implementation
- Unit tests (minimum 70% coverage)
- Follows code standards
- Participates in code reviews

### 5. **QA/Tester** 🧪
- Test case creation & execution
- Bug tracking & severity assessment
- Performance & load testing
- User acceptance testing (UAT)

### 6. **UX/Design Lead** 🎨
- Mobile-first responsive design
- Component library maintenance
- User flow optimization
- Design system consistency

---

## 📊 Sprint Workflow

```
[Sprint Planning] → [Development] → [Code Review] → [QA Testing] → [Sprint Review] → [Retrospective]
    (4-8h)            (3-4 days)      (1 day)       (1-2 days)     (2h)           (1h)
```

### Sprint Phases:

#### **1. Sprint Planning** 📝
- Define sprint goal (2-3 sentences max)
- Break down user stories into tasks (2-8h each)
- Estimate story points
- Assign owners (dev/QA)
- Acceptance criteria clearly defined
- Success metrics identified

#### **2. Development** 💪
- Daily standup (10 min): Done, Doing, Blockers
- Feature branches: `feature/sprint-X-description`
- Commit often with clear messages
- Unit tests as you code
- Mobile-first implementation
- Responsive design checkpoints

#### **3. Code Review** ✅
- Tech Lead reviews all PRs
- Checklist:
  - Code quality & standards
  - Test coverage (≥70%)
  - Performance impact
  - Mobile responsiveness
  - No breaking changes
- Request changes or approve

#### **4. QA Testing** 🧪
- Execute test cases against acceptance criteria
- Test on multiple devices (mobile, tablet, desktop)
- Bug severity levels:
  - **Critical**: App breaking, data loss
  - **High**: Major feature broken
  - **Medium**: Feature partially broken
  - **Low**: UI/UX improvement
- Regression testing on existing features

#### **5. Sprint Review** 🎉
- Demo working features to stakeholders
- Gather feedback
- Update backlog based on feedback
- Mark stories as "Done"

#### **6. Retrospective** 🔄
- What went well?
- What didn't?
- Action items for next sprint

---

## 🛠️ Development Standards

### Code Quality
- **Language**: Python (Flask backend), HTML/CSS/JS (frontend)
- **Linting**: Follow PEP8 for Python
- **Formatting**: Consistent indentation, meaningful variable names
- **Testing**: Pytest for backend, manual/automated for frontend
- **Coverage**: Minimum 70% code coverage

### Git Conventions
- Branch: `feature/sprint-X-description`
- Commits: Verb-first imperative (`Add feature X`, `Fix bug Y`)
- PR template: Title, description, testing steps, screenshots

### Design Principles
- ✅ **Mobile-First**: Design smallest screen, scale up
- ✅ **Accessibility**: WCAG 2.1 AA standard
- ✅ **Performance**: <3s load time, <100KB JS bundle (optimized)
- ✅ **Consistency**: Use established component library
- ✅ **Feedback**: Clear loading states, error messages, success confirmations

### Performance Targets
- Page Load: <3 seconds (3G)
- Interaction Response: <100ms
- Animation Frame Rate: 60 FPS
- Image Optimization: WEBP format, responsive sizes
- Bundle Size: Minimize JavaScript

---

## 📦 Current Architecture

```
fairfares.com/
├── app.py                 # Flask backend, routes & logic
├── static/
│   ├── css/styles.css    # Global & component styles
│   ├── js/app.js         # Frontend logic
│   └── img/              # Assets & logo
├── templates/            # Jinja2 HTML templates
│   ├── index.html        # Home
│   ├── explorer.html     # Main ride explorer (gamified)
│   ├── dashboard.html    # User dashboard
│   ├── admin*.html       # Admin dashboards
│   └── ...
└── CLAUDE.md            # This file
```

### Tech Stack
- **Backend**: Flask (Python)
- **Frontend**: HTML5, CSS3, Vanilla JS
- **Database**: (Database type TBD)
- **Styling**: CSS Grid/Flexbox, responsive
- **Icons/Fonts**: TBD

---

## 🚀 Ready for Next Sprint

### To Start a New Sprint:

1. **Provide Use Case** → "I want users to be able to [feature]"
2. **Clarify Requirements** → User stories, success metrics
3. **Design Phase** → Mockups for mobile/desktop
4. **Estimate Effort** → Story points & timeline
5. **Assign Owners** → Dev lead, QA lead, Designer
6. **Execute Sprint** → Team works collaboratively

### Questions I'll Ask:
- Who is the primary user?
- What's the business value?
- Mobile priority or equal?
- Performance constraints?
- Integration with existing features?

---

## 📋 Backlog Item Template

```
Title: [Feature Name]
Priority: [P0/P1/P2/P3]
Story Points: [1-13]
Sprint: [Sprint X]

User Story:
As a [user type], I want to [action], so that [benefit]

Acceptance Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Mobile & desktop responsive
- [ ] Error states handled

Success Metrics:
- Metric 1: Target value
- Metric 2: Target value

Technical Notes:
- Dependencies
- Potential blockers
- Design considerations
```

---

**Ready to kick off Sprint 1?** Share your use case! 🚀
